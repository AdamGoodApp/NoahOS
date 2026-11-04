"""Foxglove WebSocket bridge + MCAP episode recording on the same channels (STACK.md §5.7)."""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

import foxglove
from foxglove.channels import CompressedImageChannel
from foxglove.messages import CompressedImage, Timestamp
from google.protobuf import descriptor_pb2

from noahos.sim.v1 import sim_pb2 as pb

from ..config import Settings
from ..models import LoadedModel
from .physics import SimCore, SimEvent

log = logging.getLogger(__name__)

JOINT_STATE_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "array", "items": {"type": "string"}},
        "position": {"type": "array", "items": {"type": "number"}},
        "velocity": {"type": "array", "items": {"type": "number"}},
        "effort": {"type": "array", "items": {"type": "number"}},
    },
}
STATS_SCHEMA = {
    "type": "object",
    "properties": {
        k: {"type": "number"}
        for k in (
            "realtime_factor",
            "physics_hz",
            "step_ms",
            "render_ms",
            "cpu_percent",
            "total_power_w",
            "battery_percent",
            "task_phase",
        )
    }
    | {"mode": {"type": "string"}},
}


def _descriptor_set() -> bytes:
    fds = descriptor_pb2.FileDescriptorSet()
    pb.DESCRIPTOR.CopyToProto(fds.file.add())
    return fds.SerializeToString()


class FoxgloveBridge:
    def __init__(self, core: SimCore, lm: LoadedModel, port: int, s: Settings) -> None:
        self.core = core
        self.lm = lm
        self.names = [j.name for j in lm.joints]
        self.episodes = Path(s.sim_data_dir) / "episodes"
        self.ctx = foxglove.Context()
        self.server = foxglove.start_server(name=f"noahos {lm.robot.id}", host="0.0.0.0", port=port, context=self.ctx)
        self.joint_states = foxglove.Channel("/joint_states", schema=JOINT_STATE_SCHEMA, context=self.ctx)
        self.stats = foxglove.Channel("/sim/stats", schema=STATS_SCHEMA, context=self.ctx)
        self.telemetry = foxglove.Channel(
            "/sim/telemetry",
            schema=foxglove.Schema(name="noahos.sim.v1.Telemetry", encoding="protobuf", data=_descriptor_set()),
            message_encoding="protobuf",
            context=self.ctx,
        )
        self.images: dict[str, CompressedImageChannel] = {
            c.name: CompressedImageChannel(f"/camera/{c.name}", context=self.ctx) for c in lm.cameras
        }
        self._last_stats = 0.0
        self.writer: foxglove.MCAPWriter | None = None
        self.file: Path | None = None
        self.meta: dict = {}
        log.info("foxglove bridge on ws://0.0.0.0:%d", port)

    def on_telemetry(self, tel: pb.Telemetry) -> None:
        t = tel.sent_unix_ns
        self.joint_states.log(
            {"name": self.names, "position": list(tel.qpos), "velocity": list(tel.qvel), "effort": list(tel.torque)},
            log_time=t,
        )
        self.telemetry.log(tel.SerializeToString(), log_time=t)
        now = time.monotonic()
        if now - self._last_stats >= 0.2:
            self._last_stats = now
            st = tel.stats
            self.stats.log(
                {
                    "realtime_factor": st.realtime_factor,
                    "physics_hz": st.physics_hz,
                    "step_ms": st.step_ms,
                    "render_ms": st.render_ms,
                    "cpu_percent": st.cpu_percent,
                    "total_power_w": tel.total_power_w,
                    "battery_percent": tel.battery_percent if tel.HasField("battery_percent") else -1,
                    "task_phase": tel.task_phase,
                    "mode": pb.Mode.Name(tel.mode),
                },
                log_time=t,
            )

    def on_jpeg(self, camera: str, data: bytes, unix_ns: int) -> None:
        ch = self.images.get(camera)
        if ch is None:
            return
        ts = Timestamp(sec=unix_ns // 1_000_000_000, nsec=unix_ns % 1_000_000_000)
        ch.log(CompressedImage(timestamp=ts, frame_id=camera, data=data, format="jpeg"), log_time=unix_ns)

    def set_recording(self, start: bool, label: str) -> list[SimEvent]:
        if start:
            if self.writer is not None:
                return [SimEvent(pb.EVENT_KIND_DENIED, f"Already recording {self.file.name if self.file else ''}")]
            self.episodes.mkdir(parents=True, exist_ok=True)
            name = f"{self.lm.robot.id}-{time.strftime('%Y%m%d-%H%M%S')}.mcap"
            self.file = self.episodes / name
            self.writer = foxglove.open_mcap(self.file, context=self.ctx)
            self.meta = {"robot_id": self.lm.robot.id, "task_label": label, "started_unix_ns": time.time_ns()}
            self.writer.write_metadata("episode", {k: str(v) for k, v in self.meta.items()})
            self.core.recording = True
            return [SimEvent(pb.EVENT_KIND_RECORDING, f"Recording started: {name}")]
        if self.writer is None:
            return []
        self.writer.close()
        self.writer = None
        self.core.recording = False
        duration = (time.time_ns() - self.meta["started_unix_ns"]) / 1e9
        assert self.file is not None
        self.file.with_suffix(".json").write_text(json.dumps({**self.meta, "duration_s": round(duration, 2)}))
        return [SimEvent(pb.EVENT_KIND_RECORDING, f"Recording saved: {self.file.name} ({duration:.1f} s)")]

    def close(self) -> None:
        if self.writer is not None:
            self.set_recording(False, "")
        self.server.stop()
