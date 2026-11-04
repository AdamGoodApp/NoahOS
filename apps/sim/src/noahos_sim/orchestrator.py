"""FastAPI orchestrator: one session subprocess per robot, WebSocket proxy, episode files (STACK.md §5.2, §5.8)."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import re
import secrets
import socket
import sys
import time
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import websockets
from fastapi import Depends, FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from websockets.exceptions import ConnectionClosed

from .config import WS_MAX_MESSAGE_BYTES, Settings, robots, settings

log = logging.getLogger(__name__)
EPISODE_RE = re.compile(r"^[A-Za-z0-9_.-]+\.mcap$")


@dataclass
class Session:
    id: str
    robot_id: str
    port: int
    foxglove_port: int
    proc: asyncio.subprocess.Process
    started_unix_ns: int = field(default_factory=time.time_ns)
    reaper: asyncio.Task | None = None

    @property
    def health_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/healthz"

    def public(self, extra: dict | None = None) -> dict:
        return {
            "id": self.id,
            "robot_id": self.robot_id,
            "ws_path": f"/sessions/{self.id}/ws",
            "foxglove_port": self.foxglove_port,
            "started_unix_ns": self.started_unix_ns,
            **(extra or {}),
        }


class SessionRequest(BaseModel):
    robot_id: str


class Registry:
    def __init__(self, s: Settings) -> None:
        self.s = s
        self.by_id: dict[str, Session] = {}
        self.lock = asyncio.Lock()

    def by_robot(self, robot_id: str) -> Session | None:
        return next((x for x in self.by_id.values() if x.robot_id == robot_id), None)

    def _free_port(self) -> int:
        used = {x.port for x in self.by_id.values()}
        for p in range(self.s.sim_session_port_base, self.s.sim_session_port_base + 200):
            if p in used:
                continue
            with socket.socket() as sock:
                try:
                    sock.bind(("127.0.0.1", p))
                except OSError:
                    continue
            return p
        raise HTTPException(503, "no free session port")

    async def create(self, robot_id: str) -> tuple[Session, bool]:
        async with self.lock:
            existing = self.by_robot(robot_id)
            if existing is not None and existing.proc.returncode is None:
                return existing, False
            port = self._free_port()
            fox = port + self.s.sim_foxglove_port_offset
            sid = uuid.uuid4().hex[:12]
            proc = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                "noahos_sim.cli",
                "session",
                "--robot",
                robot_id,
                "--session-id",
                sid,
                "--port",
                str(port),
                "--foxglove-port",
                str(fox),
                env=os.environ.copy(),
            )
            sess = Session(sid, robot_id, port, fox, proc)
            self.by_id[sid] = sess
            sess.reaper = asyncio.create_task(self._reap(sess))
        try:
            await self._wait_ready(sess)
        except Exception:
            await self.delete(sess.id)
            raise
        log.info("session %s started for %s on :%d", sid, robot_id, port)
        return sess, True

    async def _wait_ready(self, sess: Session) -> None:
        async with httpx.AsyncClient(timeout=1.0) as client:
            for _ in range(300):  # 30 s
                if sess.proc.returncode is not None:
                    raise HTTPException(500, f"session process exited with {sess.proc.returncode}")
                with contextlib.suppress(httpx.HTTPError):
                    r = await client.get(sess.health_url)
                    if r.status_code == 200:
                        return
                await asyncio.sleep(0.1)
        raise HTTPException(504, "session did not become ready in 30 s")

    async def _reap(self, sess: Session) -> None:
        code = await sess.proc.wait()
        log.info("session %s (%s) exited with %s", sess.id, sess.robot_id, code)
        self.by_id.pop(sess.id, None)

    async def delete(self, sid: str) -> None:
        sess = self.by_id.pop(sid, None)
        if sess is None or sess.proc.returncode is not None:
            return
        sess.proc.terminate()
        try:
            await asyncio.wait_for(sess.proc.wait(), 5)
        except TimeoutError:
            sess.proc.kill()
            await sess.proc.wait()

    async def status(self, sess: Session) -> dict:
        try:
            async with httpx.AsyncClient(timeout=1.0) as client:
                h = (await client.get(sess.health_url)).json()
            return {"clients": h.get("clients", 0), "mode": h.get("mode"), "recording": h.get("recording", False)}
        except (httpx.HTTPError, ValueError):
            return {"clients": 0, "mode": None, "recording": False}

    async def shutdown(self) -> None:
        await asyncio.gather(*(self.delete(sid) for sid in list(self.by_id)))


def create_app(s: Settings | None = None) -> FastAPI:
    s = s or settings()
    registry = Registry(s)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        yield
        await registry.shutdown()

    app = FastAPI(title="NoahOS sim orchestrator", version="0.1.0", lifespan=lifespan)
    app.state.registry = registry

    def _authorized(header: str | None) -> bool:
        if not s.sim_shared_secret:
            return True
        return header is not None and secrets.compare_digest(header, f"Bearer {s.sim_shared_secret}")

    def require_auth(request: Request) -> None:
        if not _authorized(request.headers.get("authorization")):
            raise HTTPException(401, "missing or wrong bearer token")

    def get_session(sid: str) -> Session:
        sess = registry.by_id.get(sid)
        if sess is None:
            raise HTTPException(404, "no such session")
        return sess

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"status": "ok", "sessions": len(registry.by_id)}

    @app.get("/robots", dependencies=[Depends(require_auth)])
    async def list_robots() -> list[dict]:
        return [r.public() for r in robots().values()]

    @app.post("/sessions", dependencies=[Depends(require_auth)])
    async def create_session(body: SessionRequest, response: Response) -> dict:
        if body.robot_id not in robots():
            raise HTTPException(404, f"unknown robot {body.robot_id}")
        sess, created = await registry.create(body.robot_id)
        response.status_code = 201 if created else 200
        return sess.public(await registry.status(sess))

    @app.get("/sessions", dependencies=[Depends(require_auth)])
    async def list_sessions() -> list[dict]:
        return [x.public(await registry.status(x)) for x in list(registry.by_id.values())]

    @app.get("/sessions/{sid}", dependencies=[Depends(require_auth)])
    async def one_session(sid: str) -> dict:
        sess = get_session(sid)
        return sess.public(await registry.status(sess))

    @app.delete("/sessions/{sid}", status_code=204, dependencies=[Depends(require_auth)])
    async def delete_session(sid: str) -> Response:
        get_session(sid)
        await registry.delete(sid)
        return Response(status_code=204)

    def episodes_dir() -> Path:
        return Path(s.sim_data_dir) / "episodes"

    @app.get("/sessions/{sid}/episodes", dependencies=[Depends(require_auth)])
    async def list_episodes(sid: str) -> list[dict]:
        sess = get_session(sid)
        out = []
        d = episodes_dir()
        if d.is_dir():
            for f in sorted(d.glob(f"{sess.robot_id}-*.mcap"), reverse=True):
                meta_path = f.with_suffix(".json")
                meta = json.loads(meta_path.read_text()) if meta_path.is_file() else {}
                out.append({"file": f.name, "bytes": f.stat().st_size, **meta})
        return out

    @app.get("/sessions/{sid}/episodes/{name}", dependencies=[Depends(require_auth)])
    async def download_episode(sid: str, name: str) -> FileResponse:
        sess = get_session(sid)
        if not EPISODE_RE.match(name) or not name.startswith(f"{sess.robot_id}-"):
            raise HTTPException(400, "bad episode name")
        path = episodes_dir() / name
        if not path.is_file():
            raise HTTPException(404, "no such episode")
        return FileResponse(path, media_type="application/octet-stream", filename=name)

    @app.websocket("/sessions/{sid}/ws")
    async def proxy(ws: WebSocket, sid: str) -> None:
        if not _authorized(ws.headers.get("authorization")):
            await ws.close(code=1008)
            return
        sess = registry.by_id.get(sid)
        if sess is None:
            await ws.close(code=1011)
            return
        await ws.accept()
        try:
            async with websockets.connect(f"ws://127.0.0.1:{sess.port}/ws", max_size=WS_MAX_MESSAGE_BYTES) as upstream:

                async def down() -> None:
                    async for data in upstream:
                        if isinstance(data, bytes):
                            await ws.send_bytes(data)

                async def up() -> None:
                    while True:
                        msg = await ws.receive()
                        if msg["type"] == "websocket.disconnect":
                            return
                        if msg.get("bytes") is not None:
                            await upstream.send(msg["bytes"])

                tasks = [asyncio.create_task(down()), asyncio.create_task(up())]
                _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for t in pending:
                    t.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
        except (ConnectionClosed, WebSocketDisconnect, OSError) as e:
            log.info("proxy for %s closed: %s", sid, e)
        finally:
            with contextlib.suppress(RuntimeError, WebSocketDisconnect):
                await ws.close()

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code)

    return app
