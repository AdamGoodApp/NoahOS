"""Settings (environment) and robot configuration (robots.yaml)."""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from typing import Annotated, Literal

import yaml
from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

WS_MAX_MESSAGE_BYTES = 2**20
APP_DIR = Path(__file__).resolve().parents[2]  # apps/sim (or /app in the image)


def _default_menagerie() -> str:
    for candidate in (Path("/opt/menagerie"), APP_DIR / ".menagerie"):
        if candidate.is_dir():
            return str(candidate)
    return str(APP_DIR / ".menagerie")


class IceServer(BaseModel):
    urls: str | list[str]
    username: str | None = None
    credential: str | None = None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    menagerie_dir: str = Field(default_factory=_default_menagerie)
    sim_robots_file: str = str(APP_DIR / "robots.yaml")
    sim_data_dir: str = "/data"
    sim_telemetry_hz: float = 60.0
    sim_cameras_enabled: bool = True
    sim_camera_fps: int | None = None
    sim_camera_width: int | None = None
    sim_camera_height: int | None = None
    sim_shared_secret: str = ""
    cf_realtime_app_id: str = ""
    cf_realtime_app_secret: str = ""
    cf_realtime_api: str = "https://rtc.live.cloudflare.com/v1"
    # NoDecode: the validator below parses the JSON itself, so an empty value means "default STUN only".
    sim_ice_servers: Annotated[list[IceServer], NoDecode] = Field(
        default_factory=lambda: [IceServer(urls="stun:stun.cloudflare.com:3478")]
    )
    sim_log_level: str = "INFO"
    sim_session_port_base: int = 8100
    sim_foxglove_port_offset: int = 900
    sim_foxglove_enabled: bool = True

    @field_validator("sim_ice_servers", mode="before")
    @classmethod
    def _parse_ice(cls, v: object) -> object:
        if isinstance(v, str):
            return json.loads(v) if v.strip() else [{"urls": "stun:stun.cloudflare.com:3478"}]
        return v


class CameraConfig(BaseModel):
    name: str
    width: int = 320
    height: int = 240
    fps: int = 15
    # Extra (injected) cameras only: mount body, position in the body frame, MJCF xyaxes.
    body: str | None = None
    pos: list[float] | None = None
    xyaxes: list[float] | None = None


class ThermalConfig(BaseModel):
    ambient_c: float = 25.0
    k_heat: float = 0.0005
    k_cool: float = 0.02
    initial_c: float = 35.0


class RobotConfig(BaseModel):
    id: str
    mjcf: str
    battery_wh: float = 0.0
    drive: Literal["servo", "kinematic"] = "servo"
    camera_defaults: CameraConfig
    cameras: list[CameraConfig] = Field(default_factory=list)
    thermal: ThermalConfig = Field(default_factory=ThermalConfig)

    def generic_cameras(self) -> list[CameraConfig]:
        """The two cameras every robot gets (models.py places them)."""
        base = self.camera_defaults.model_dump(exclude={"name", "body", "pos", "xyaxes"})
        return [CameraConfig(name="third_person", **base), CameraConfig(name="rear", **base)]

    def public(self) -> dict:
        return {
            "id": self.id,
            "mjcf": self.mjcf,
            "cameras": [
                c.model_dump(include={"name", "width", "height", "fps"}) for c in self.generic_cameras() + self.cameras
            ],
            "battery_wh": self.battery_wh,
            "drive": self.drive,
        }


def load_robots(path: str | Path) -> dict[str, RobotConfig]:
    raw = yaml.safe_load(Path(path).read_text())
    d = raw.get("defaults", {})
    out: dict[str, RobotConfig] = {}
    for rid, r in raw["robots"].items():
        cam_def = {"name": "_default", **d.get("camera", {})}
        cams = [{**d.get("camera", {}), **c} for c in r.get("cameras", [])]
        out[rid] = RobotConfig(
            id=rid,
            mjcf=r["mjcf"],
            battery_wh=r.get("battery_wh", 0),
            drive=r.get("drive", d.get("drive", "servo")),
            camera_defaults=cam_def,
            cameras=cams,
            thermal={**d.get("thermal", {}), **r.get("thermal", {})},
        )
    return out


@cache
def settings() -> Settings:
    return Settings()


@cache
def robots() -> dict[str, RobotConfig]:
    return load_robots(settings().sim_robots_file)
