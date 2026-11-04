from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
import time
import urllib.request
from collections.abc import Iterator

import pytest
import websockets

from noahos.sim.v1 import sim_pb2 as pb


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def session_port(menagerie_settings) -> Iterator[int]:
    port = free_port()
    env = {
        **os.environ,
        "SIM_CAMERAS_ENABLED": "false",
        "SIM_FOXGLOVE_ENABLED": "false",
        "MENAGERIE_DIR": menagerie_settings.menagerie_dir,
    }
    proc = subprocess.Popen(
        [sys.executable, "-m", "noahos_sim.cli", "session", "--robot", "franka_fr3", "--port", str(port)], env=env
    )
    try:
        deadline = time.time() + 30
        while time.time() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"session exited with {proc.returncode}")
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=1).read()
                break
            except OSError:
                time.sleep(0.1)
        else:
            pytest.fail("session not ready")
        yield port
    finally:
        proc.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()


async def recv(ws) -> pb.ServerMessage:
    m = pb.ServerMessage()
    m.ParseFromString(await asyncio.wait_for(ws.recv(), 5))
    return m


async def until(ws, kind: str, pred=lambda m: True, timeout: float = 5.0) -> pb.ServerMessage:
    end = time.time() + timeout
    while time.time() < end:
        m = await recv(ws)
        if m.WhichOneof("msg") == kind and pred(getattr(m, kind)):
            return m
    raise AssertionError(f"no {kind}")


async def test_welcome_then_telemetry_rate(session_port: int) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{session_port}/ws") as ws:
        first = await recv(ws)
        assert first.WhichOneof("msg") == "welcome"
        assert first.welcome.policies[0].id == "sweep"
        await until(ws, "telemetry")
        t0 = time.time()
        n = 0
        while time.time() - t0 < 0.5:
            m = await recv(ws)
            n += m.WhichOneof("msg") == "telemetry"
        assert n >= 10, n


async def test_ping_pong(session_port: int) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{session_port}/ws") as ws:
        await ws.send(pb.ClientMessage(ping=pb.Ping(client_id="abc", client_ms=123)).SerializeToString())
        pong = (await until(ws, "pong")).pong
        assert pong.client_id == "abc" and pong.client_ms == 123 and pong.server_unix_ns > 0


async def test_targets_then_estop(session_port: int) -> None:
    async with websockets.connect(f"ws://127.0.0.1:{session_port}/ws") as ws:
        welcome = (await until(ws, "welcome")).welcome
        hi = welcome.robot.joints[0].range_max
        assert welcome.mode == pb.MODE_MANUAL  # a new session holds its pose
        await ws.send(pb.ClientMessage(set_mode=pb.SetMode(mode=pb.MODE_AUTO)).SerializeToString())
        await until(ws, "telemetry", lambda t: t.mode == pb.MODE_AUTO)
        await ws.send(
            pb.ClientMessage(joint_targets=pb.JointTargets(joint_index=[0], target=[0.1])).SerializeToString()
        )
        assert (await until(ws, "event")).event.kind == pb.EVENT_KIND_DENIED  # task running
        await ws.send(pb.ClientMessage(set_mode=pb.SetMode(mode=pb.MODE_MANUAL)).SerializeToString())
        await until(ws, "telemetry", lambda t: t.mode == pb.MODE_MANUAL)
        await ws.send(
            pb.ClientMessage(joint_targets=pb.JointTargets(joint_index=[0], target=[1e3])).SerializeToString()
        )
        tel = (await until(ws, "telemetry", lambda t: t.mode == pb.MODE_MANUAL)).telemetry
        assert tel.target[0] == pytest.approx(hi, abs=1e-5)
        await ws.send(pb.ClientMessage(estop=pb.EStop()).SerializeToString())
        tel = (await until(ws, "telemetry", lambda t: t.mode == pb.MODE_STOPPED)).telemetry
        assert len(tel.qpos) == len(welcome.robot.joints)
        await ws.send(pb.ClientMessage(set_mode=pb.SetMode(mode=pb.MODE_AUTO)).SerializeToString())
        await until(ws, "telemetry", lambda t: t.mode == pb.MODE_AUTO)
