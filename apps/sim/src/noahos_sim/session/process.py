"""Entry for `noahos-sim session`: one robot, physics + render threads, asyncio WebSocket server."""

from __future__ import annotations

import asyncio
import logging
import signal

from noahos.sim.v1 import sim_pb2 as pb

from ..config import Settings, robots
from ..models import load
from .physics import PhysicsThread, SimCore, SimEvent
from .ws import SessionServer

log = logging.getLogger(__name__)


async def run_session(robot_id: str, session_id: str, host: str, port: int, foxglove_port: int, s: Settings) -> None:
    cfg = robots()[robot_id]
    lm = load(cfg, s)
    core = SimCore(lm)
    server = SessionServer(core, session_id, s.sim_telemetry_hz)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    server.loop = loop
    physics = PhysicsThread(core, s.sim_telemetry_hz, server.telemetry_from_thread)
    physics.start()
    log.info(
        "robot %s: %d joints, base=%s, drive=%s, dt=%.4f",
        robot_id,
        len(lm.joints),
        lm.base_joint or "fixed",
        core.drive.kind,
        core.dt,
    )

    bridge = None
    if s.sim_foxglove_enabled and foxglove_port:
        from .foxglove_bridge import FoxgloveBridge

        bridge = FoxgloveBridge(core, lm, foxglove_port, s)
        server.telemetry_listeners.append(bridge.on_telemetry)
        server.on_recording = bridge.set_recording

    render = publisher = None
    if s.sim_cameras_enabled and lm.cameras:
        from .cameras import RenderThread

        render = RenderThread(core, lm.cameras, loop)
        if bridge is not None:
            render.jpeg_sink = bridge.on_jpeg
        render.start()
        server.cameras = render.specs(None)
        if s.cf_realtime_app_id and s.cf_realtime_app_secret:
            from .rtc import RtcPublisher

            publisher = RtcPublisher(render, s, on_published=_on_published(server))
            publisher.launch()  # in the background: telemetry must not wait for ICE gathering
        else:
            log.warning("camera streams unavailable: no Realtime credentials (CF_REALTIME_APP_ID/SECRET)")

    try:
        await server.serve(host, port, stop)
    finally:
        physics.stop()
        if render is not None:
            render.stop()
        if publisher is not None:
            await publisher.close()
        if bridge is not None:
            bridge.close()
        physics.join(timeout=2)


def _on_published(server: SessionServer):
    def apply(specs: list[pb.CameraSpec]) -> None:
        server.cameras = specs
        server.broadcast_welcome()
        live = [c.name for c in specs if c.sfu_session_id]
        message = f"Cameras streaming: {', '.join(live)}" if live else "Camera streams down; reconnecting"
        server.emit([SimEvent(pb.EVENT_KIND_INFO, message)])

    return apply
