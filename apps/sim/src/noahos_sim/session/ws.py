"""Session WebSocket server: §4 protocol between the relay (or a probe) and one SimCore."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import Callable
from http import HTTPStatus

from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Request, Response

from noahos.sim.v1 import sim_pb2 as pb

from ..config import WS_MAX_MESSAGE_BYTES
from .physics import SimCore, SimEvent

log = logging.getLogger(__name__)


class Client:
    """One connected socket with a latest-wins outbound queue so a slow reader never stalls physics."""

    def __init__(self, conn: ServerConnection) -> None:
        self.conn = conn
        self.queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=4)
        self.task: asyncio.Task | None = None

    def push(self, data: bytes) -> None:
        if self.queue.full():
            with contextlib.suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()
        self.queue.put_nowait(data)

    async def pump(self) -> None:
        with contextlib.suppress(ConnectionClosed):
            while True:
                await self.conn.send(await self.queue.get())


class SessionServer:
    def __init__(self, core: SimCore, session_id: str, telemetry_hz: float) -> None:
        self.core = core
        self.session_id = session_id
        self.telemetry_hz = telemetry_hz
        self.clients: set[Client] = set()
        self.cameras: list[pb.CameraSpec] = []
        self.loop: asyncio.AbstractEventLoop | None = None
        # Hooks set by the session process (Phase 3/5 features).
        self.on_recording: Callable[[bool, str], list[SimEvent]] | None = None
        self.telemetry_listeners: list[Callable[[pb.Telemetry], None]] = []

    # ---- outbound ---------------------------------------------------------------------------

    def welcome(self) -> bytes:
        msg = pb.ServerMessage(
            welcome=pb.Welcome(
                session_id=self.session_id,
                robot=self.core.robot_spec(),
                mode=self.core.mode,
                cameras=self.cameras,
                telemetry_hz=round(self.telemetry_hz),
                policies=[
                    pb.PolicySpec(
                        id=p.spec.id,
                        name=p.spec.name,
                        description=p.spec.description,
                        period_s=p.spec.period_s,
                        holds_base=p.holds_base,
                    )
                    for p in self.core.policies
                ],
            )
        )
        return msg.SerializeToString()

    def broadcast(self, data: bytes) -> None:
        for c in list(self.clients):
            c.push(data)

    def broadcast_welcome(self) -> None:
        self.broadcast(self.welcome())

    def emit(self, events: list[SimEvent]) -> None:
        for e in events:
            ev = pb.Event(kind=e.kind, message=e.message, mode=e.mode, unix_ns=time.time_ns())
            self.broadcast(pb.ServerMessage(event=ev).SerializeToString())
            log.info("event %s %s", pb.EventKind.Name(e.kind), e.message)

    def telemetry_from_thread(self, tel: pb.Telemetry) -> None:
        """Called by the physics thread; hands the frame to the event loop."""
        if self.loop is not None:
            self.loop.call_soon_threadsafe(self._publish, tel)

    def _publish(self, tel: pb.Telemetry) -> None:
        tel.sent_unix_ns = time.time_ns()
        if self.core.pending_events:
            events, self.core.pending_events = self.core.pending_events, []
            self.emit(events)
        self.broadcast(pb.ServerMessage(telemetry=tel).SerializeToString())
        for listener in self.telemetry_listeners:
            try:
                listener(tel)
            except Exception:  # a broken sink must not stop telemetry
                log.exception("telemetry listener failed")

    # ---- inbound ----------------------------------------------------------------------------

    def handle(self, client: Client, raw: bytes) -> None:
        msg = pb.ClientMessage()
        try:
            msg.ParseFromString(raw)
        except Exception:
            log.warning("undecodable client frame (%d bytes)", len(raw))
            return
        kind = msg.WhichOneof("msg")
        core = self.core
        if kind == "ping":
            pong = pb.Pong(client_id=msg.ping.client_id, client_ms=msg.ping.client_ms, server_unix_ns=time.time_ns())
            client.push(pb.ServerMessage(pong=pong).SerializeToString())
        elif kind == "joint_targets":
            jt = msg.joint_targets
            self.emit(core.set_targets(list(jt.joint_index), list(jt.target)))
        elif kind == "set_mode":
            self.emit(core.set_mode(msg.set_mode.mode, msg.set_mode.policy))
        elif kind == "estop":
            self.emit(core.estop())
        elif kind == "recording":
            if self.on_recording is None:
                self.emit([SimEvent(pb.EVENT_KIND_DENIED, "Recording is not available in this session")])
            else:
                self.emit(self.on_recording(msg.recording.start, msg.recording.task_label))
        elif kind == "hello":
            log.info("hello from %s", msg.hello.client_id)

    async def _handler(self, conn: ServerConnection) -> None:
        client = Client(conn)
        self.clients.add(client)
        client.task = asyncio.create_task(client.pump())
        client.push(self.welcome())
        log.info("client connected (%d)", len(self.clients))
        try:
            async for raw in conn:
                if isinstance(raw, bytes):
                    self.handle(client, raw)
        except ConnectionClosed:
            pass
        finally:
            self.clients.discard(client)
            client.task.cancel()
            log.info("client disconnected (%d)", len(self.clients))

    def health(self) -> dict:
        return {
            "status": "ok",
            "robot_id": self.core.lm.robot.id,
            "session_id": self.session_id,
            "mode": pb.Mode.Name(self.core.mode),
            "clients": len(self.clients),
            "recording": self.core.recording,
        }

    def _process_request(self, conn: ServerConnection, request: Request) -> Response | None:
        if request.path.startswith("/healthz"):
            response = conn.respond(HTTPStatus.OK, json.dumps(self.health()))
            response.headers["Content-Type"] = "application/json"
            return response
        if not request.path.startswith("/ws"):
            return conn.respond(HTTPStatus.NOT_FOUND, "not found\n")
        return None

    async def serve(self, host: str, port: int, stop: asyncio.Event) -> None:
        async with serve(
            self._handler, host, port, process_request=self._process_request, max_size=WS_MAX_MESSAGE_BYTES
        ):
            log.info("session %s listening on %s:%d", self.session_id, host, port)
            await stop.wait()
