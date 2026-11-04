"""Offscreen camera rendering (MuJoCo Renderer on its own thread) feeding aiortc video tracks (STACK.md §5.6)."""

from __future__ import annotations

import asyncio
import fractions
import io
import logging
import os
import threading
import time
from collections.abc import Callable

import av
import mujoco
from aiortc import VideoStreamTrack
from PIL import Image

from noahos.sim.v1 import sim_pb2 as pb

from ..config import CameraConfig
from .physics import SimCore

log = logging.getLogger(__name__)

VIDEO_CLOCK = 90_000
JPEG_EVERY = 3  # Foxglove/MCAP images at a third of the camera rate

# Software GL (llvmpipe) spends ~75 % of a frame on shadows, reflections and the skybox; cameras skip them.
COSTLY_EFFECTS = (mujoco.mjtRndFlag.mjRND_SHADOW, mujoco.mjtRndFlag.mjRND_REFLECTION, mujoco.mjtRndFlag.mjRND_SKYBOX)


def fast_renderer(model: mujoco.MjModel, height: int, width: int) -> mujoco.Renderer:
    r = mujoco.Renderer(model, height=height, width=width)
    for flag in COSTLY_EFFECTS:
        r.scene.flags[flag] = False
    return r


class CameraTrack(VideoStreamTrack):
    """Newest-frame-wins video track; pts from a 90 kHz wall clock started at the first frame."""

    def __init__(self, name: str) -> None:
        super().__init__()
        self.name = name
        self._queue: asyncio.Queue[av.VideoFrame] = asyncio.Queue(maxsize=1)
        self._t0: float | None = None

    def put(self, frame: av.VideoFrame) -> None:
        if self._queue.full():
            self._queue.get_nowait()
        self._queue.put_nowait(frame)

    async def recv(self) -> av.VideoFrame:
        frame = await self._queue.get()
        now = time.perf_counter()
        if self._t0 is None:
            self._t0 = now
        frame.pts = int((now - self._t0) * VIDEO_CLOCK)
        frame.time_base = fractions.Fraction(1, VIDEO_CLOCK)
        return frame


class RenderThread(threading.Thread):
    def __init__(self, core: SimCore, cameras: list[CameraConfig], loop: asyncio.AbstractEventLoop) -> None:
        super().__init__(name="render", daemon=True)
        self.core = core
        self.cameras = cameras
        self.loop = loop
        self.tracks = {c.name: CameraTrack(c.name) for c in cameras}
        self.jpeg_sink: Callable[[str, bytes, int], None] | None = None
        self._halt = threading.Event()

    def stop(self) -> None:
        self._halt.set()

    def specs(self, published: dict[str, str] | None) -> list[pb.CameraSpec]:
        """`published`: camera name → publisher SFU session id, for cameras whose track is live."""
        published = published or {}
        return [
            pb.CameraSpec(
                name=c.name,
                width=c.width,
                height=c.height,
                fps=c.fps,
                sfu_session_id=published.get(c.name, ""),
                track_name=c.name if c.name in published else "",
            )
            for c in self.cameras
        ]

    def run(self) -> None:
        model = self.core.model
        renderers: dict[tuple[int, int], mujoco.Renderer] = {}
        try:
            for c in self.cameras:
                key = (c.height, c.width)
                if key not in renderers:
                    renderers[key] = fast_renderer(model, c.height, c.width)
        except Exception:
            log.exception("offscreen rendering unavailable (MUJOCO_GL=%s); cameras disabled", _gl())
            return
        log.info("rendering %d cameras with MUJOCO_GL=%s", len(self.cameras), _gl())
        due = {c.name: time.perf_counter() for c in self.cameras}
        count = {c.name: 0 for c in self.cameras}
        while not self._halt.is_set():
            now = time.perf_counter()
            cam = min(self.cameras, key=lambda c: due[c.name])
            wait = due[cam.name] - now
            if wait > 0:
                time.sleep(wait)
                continue
            due[cam.name] = max(due[cam.name] + 1.0 / cam.fps, now)
            renderer = renderers[(cam.height, cam.width)]
            t0 = time.perf_counter()
            with self.core.lock:
                renderer.update_scene(self.core.data, camera=cam.name)
            rgb = renderer.render()
            t1 = time.perf_counter()
            self.core.stats.add_render(t1, (t1 - t0) * 1000.0)
            frame = av.VideoFrame.from_ndarray(rgb, format="rgb24")
            self.loop.call_soon_threadsafe(self.tracks[cam.name].put, frame)
            count[cam.name] += 1
            if self.jpeg_sink is not None and count[cam.name] % JPEG_EVERY == 0:
                buf = io.BytesIO()
                Image.fromarray(rgb).save(buf, format="JPEG", quality=70)
                self.loop.call_soon_threadsafe(self.jpeg_sink, cam.name, buf.getvalue(), time.time_ns())
        for r in renderers.values():
            r.close()


def _gl() -> str:
    return os.environ.get("MUJOCO_GL", "default")
