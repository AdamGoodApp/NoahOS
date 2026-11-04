"""noahos-sim: serve (orchestrator) | session (one robot) | probe (end-to-end check)."""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time
import uuid

from noahos.sim.v1 import sim_pb2 as pb

from . import logging as jlog
from .config import WS_MAX_MESSAGE_BYTES, settings


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="noahos-sim")
    sub = p.add_subparsers(dest="cmd", required=True)
    sv = sub.add_parser("serve", help="run the orchestrator (FastAPI)")
    sv.add_argument("--host", default="0.0.0.0")
    sv.add_argument("--port", type=int, default=8000)
    se = sub.add_parser("session", help="run one robot session (spawned by the orchestrator)")
    se.add_argument("--robot", required=True)
    se.add_argument("--session-id", default="")
    se.add_argument("--host", default="127.0.0.1")
    se.add_argument("--port", type=int, required=True)
    se.add_argument("--foxglove-port", type=int, default=0)
    pr = sub.add_parser("probe", help="create a session and check telemetry, control and E-stop")
    pr.add_argument("--robot", default="unitree_g1")
    pr.add_argument("--url", default="http://localhost:8000")
    pr.add_argument("--seconds", type=float, default=2.0)
    a = p.parse_args(argv)
    s = settings()

    if a.cmd == "serve":
        import uvicorn

        from .orchestrator import create_app

        jlog.setup(s.sim_log_level, service="orchestrator")
        uvicorn.run(create_app(s), host=a.host, port=a.port, log_config=None, ws_max_size=WS_MAX_MESSAGE_BYTES)
    elif a.cmd == "session":
        from .session.process import run_session

        jlog.setup(s.sim_log_level, service="session", robot=a.robot, session=a.session_id)
        asyncio.run(run_session(a.robot, a.session_id or uuid.uuid4().hex[:12], a.host, a.port, a.foxglove_port, s))
    else:
        ok = asyncio.run(probe(a.url, a.robot, a.seconds, s.sim_shared_secret))
        sys.exit(0 if ok else 1)


async def probe(url: str, robot: str, seconds: float, secret: str) -> bool:
    import httpx
    import websockets

    headers = {"Authorization": f"Bearer {secret}"} if secret else {}
    t0 = time.perf_counter()
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(f"{url}/sessions", json={"robot_id": robot}, headers=headers)
        r.raise_for_status()
        sess = r.json()
    print(f"session {sess['id']} for {robot} ready in {time.perf_counter() - t0:.2f} s (HTTP {r.status_code})")

    ws_url = url.replace("http", "ws", 1) + sess["ws_path"]
    async with websockets.connect(ws_url, additional_headers=headers, max_size=WS_MAX_MESSAGE_BYTES) as ws:
        cid = "probe-" + uuid.uuid4().hex[:6]
        await ws.send(pb.ClientMessage(hello=pb.Hello(client_id=cid, role=pb.ROLE_OPERATOR)).SerializeToString())
        welcome: pb.Welcome | None = None
        arrivals: list[float] = []
        rtts: list[float] = []
        last: pb.Telemetry | None = None
        deadline = time.perf_counter() + seconds
        next_ping = 0.0
        while time.perf_counter() < deadline:
            now = time.perf_counter()
            if now >= next_ping:
                ping = pb.Ping(client_id=cid, client_ms=int(time.time() * 1000))
                await ws.send(pb.ClientMessage(ping=ping).SerializeToString())
                next_ping = now + 0.25
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
            except TimeoutError:
                continue
            m = pb.ServerMessage.FromString(raw)
            kind = m.WhichOneof("msg")
            if kind == "welcome":
                welcome = m.welcome
            elif kind == "telemetry":
                arrivals.append(time.perf_counter())
                last = m.telemetry
            elif kind == "pong":
                rtts.append(time.time() * 1000 - m.pong.client_ms)
        if welcome is None or last is None or len(arrivals) < 2:
            print("FAIL: no welcome/telemetry")
            return False
        hz = (len(arrivals) - 1) / (arrivals[-1] - arrivals[0])
        names = [j.name for j in welcome.robot.joints]
        print(
            f"welcome: {len(names)} joints, base={welcome.robot.base_joint or 'fixed'}, "
            f"cameras={[c.name for c in welcome.cameras]}"
        )
        print(f"telemetry: {hz:.1f} Hz over {len(arrivals)} frames, mode={pb.Mode.Name(last.mode)}")
        print(f"rtt: median {statistics.median(rtts):.2f} ms, max {max(rtts):.2f} ms ({len(rtts)} pings)")
        print("first joints: " + ", ".join(f"{n}={q:+.3f}" for n, q in list(zip(names, last.qpos, strict=False))[:4]))
        print(
            f"stats: rtf={last.stats.realtime_factor:.2f} physics={last.stats.physics_hz:.0f} Hz "
            f"step={last.stats.step_ms:.3f} ms cpu={last.stats.cpu_percent:.0f}%"
        )

        idx = next(i for i, j in enumerate(welcome.robot.joints) if j.actuated)
        j = welcome.robot.joints[idx]
        goal = (j.range_min + j.range_max) / 2 if j.limited else last.qpos[idx] + 0.3
        # Joints are commanded only in Manual hold (the sim refuses targets while the task runs).
        await ws.send(pb.ClientMessage(set_mode=pb.SetMode(mode=pb.MODE_MANUAL)).SerializeToString())
        await ws.send(
            pb.ClientMessage(joint_targets=pb.JointTargets(joint_index=[idx], target=[goal])).SerializeToString()
        )
        moved = await _until(ws, lambda t: t.mode == pb.MODE_MANUAL and abs(t.qpos[idx] - goal) < 0.05, 3.0)
        print(
            f"JointTargets {j.name} -> {goal:+.3f}: {'moved, mode=MANUAL' if moved else 'FAIL'}"
            + (f" (q={moved.qpos[idx]:+.3f})" if moved else "")
        )
        await ws.send(pb.ClientMessage(estop=pb.EStop()).SerializeToString())
        stopped = await _until(ws, lambda t: t.mode == pb.MODE_STOPPED, 2.0)
        print(f"EStop: {'mode=STOPPED' if stopped else 'FAIL'}")
        await ws.send(pb.ClientMessage(set_mode=pb.SetMode(mode=pb.MODE_AUTO)).SerializeToString())
        return bool(moved and stopped and hz > 50)


async def _until(ws, cond, timeout: float):
    end = time.perf_counter() + timeout
    while time.perf_counter() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=max(0.01, end - time.perf_counter()))
        except TimeoutError:
            break
        m = pb.ServerMessage.FromString(raw)
        if m.WhichOneof("msg") == "telemetry" and cond(m.telemetry):
            return m.telemetry
    return None


if __name__ == "__main__":
    main()
