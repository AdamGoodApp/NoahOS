"""Publish camera tracks to Cloudflare Realtime SFU with aiortc (STACK.md §3.2, §5.6).

One RTCPeerConnection (one SFU session) per camera: aiortc does not complete ICE for a BUNDLE group
answered by the SFU's ICE-lite endpoint with several m-lines, while a single m-line connects reliably.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Callable

import httpx
from aiortc import RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCRtpSender, RTCSessionDescription

from noahos.sim.v1 import sim_pb2 as pb

from ..config import Settings
from .cameras import CameraTrack, RenderThread

log = logging.getLogger(__name__)
BACKOFF_S = (1, 2, 4, 8)
CONNECT_TIMEOUT_S = 15


def ice_servers(s: Settings) -> list[RTCIceServer]:
    return [RTCIceServer(urls=i.urls, username=i.username, credential=i.credential) for i in s.sim_ice_servers]


class CameraPeer:
    """Publishes one camera track into its own SFU session and re-publishes when the connection drops."""

    def __init__(self, name: str, track: CameraTrack, s: Settings, on_change: Callable[[], None]) -> None:
        self.name = name
        self.track = track
        self.s = s
        self.on_change = on_change
        self.pc: RTCPeerConnection | None = None
        self.sfu_session_id = ""
        self.connected = asyncio.Event()
        self._failed = asyncio.Event()
        self._closing = False
        self._task: asyncio.Task | None = None
        self.base = f"{s.cf_realtime_api}/apps/{s.cf_realtime_app_id}"
        self.headers = {"Authorization": f"Bearer {s.cf_realtime_app_secret}"}

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        attempt = 0
        while not self._closing:
            try:
                await self._publish()
                await asyncio.wait_for(self.connected.wait(), CONNECT_TIMEOUT_S)
                attempt = 0
                await self._failed.wait()
            except Exception as e:  # network, SFU errors, ICE timeout: retry with backoff
                log.warning("camera %s publish failed: %s", self.name, e or type(e).__name__)
            if self._closing:
                return
            self.sfu_session_id = ""
            self.on_change()
            await asyncio.sleep(BACKOFF_S[min(attempt, len(BACKOFF_S) - 1)])
            attempt += 1

    async def _publish(self) -> None:
        if self.pc is not None:
            await self.pc.close()
        self.connected.clear()
        self._failed.clear()
        pc = RTCPeerConnection(RTCConfiguration(iceServers=ice_servers(self.s)))
        self.pc = pc
        tr = pc.addTransceiver(self.track, direction="sendonly")
        h264 = [c for c in RTCRtpSender.getCapabilities("video").codecs if c.mimeType == "video/H264"]
        if h264:
            tr.setCodecPreferences(h264)

        @pc.on("connectionstatechange")
        async def _state() -> None:
            if pc is not self.pc:
                return
            log.info("camera %s sfu connection %s", self.name, pc.connectionState)
            if pc.connectionState == "connected":
                self.connected.set()
                self.on_change()
            elif pc.connectionState in ("failed", "closed") and not self._closing:
                self._failed.set()

        await pc.setLocalDescription(await pc.createOffer())  # aiortc gathers all ICE candidates first
        async with httpx.AsyncClient(timeout=15, headers=self.headers) as http:
            r = await http.post(f"{self.base}/sessions/new")
            r.raise_for_status()
            sid = r.json()["sessionId"]
            body = {
                "sessionDescription": {"type": "offer", "sdp": pc.localDescription.sdp},
                "tracks": [{"location": "local", "mid": tr.mid, "trackName": self.name}],
            }
            r = await http.post(f"{self.base}/sessions/{sid}/tracks/new", json=body)
            r.raise_for_status()
            res = r.json()
        if res.get("errorCode"):
            raise RuntimeError(f"SFU tracks/new: {res.get('errorCode')} {res.get('errorDescription')}")
        answer = res["sessionDescription"]
        await pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))
        self.sfu_session_id = sid

    async def close(self) -> None:
        self._closing = True
        self._failed.set()
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if self.pc is not None:
            await self.pc.close()


class RtcPublisher:
    """All cameras of a session. Calls on_published with fresh CameraSpecs whenever a camera (re)connects or drops."""

    def __init__(self, render: RenderThread, s: Settings, on_published: Callable[[list[pb.CameraSpec]], None]) -> None:
        self.render = render
        self.on_published = on_published
        self.peers = [CameraPeer(name, track, s, self._changed) for name, track in render.tracks.items()]
        self._last: dict[str, str] = {}

    def launch(self) -> None:
        for p in self.peers:
            p.start()

    def _changed(self) -> None:
        live = {p.name: p.sfu_session_id for p in self.peers if p.connected.is_set() and p.sfu_session_id}
        if live == self._last:
            return
        self._last = live
        log.info("cameras published: %s", ", ".join(live) or "none")
        self.on_published(self.render.specs(live))

    async def close(self) -> None:
        await asyncio.gather(*(p.close() for p in self.peers))
