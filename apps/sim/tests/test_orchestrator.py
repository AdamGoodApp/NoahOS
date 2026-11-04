from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from noahos_sim.config import Settings
from noahos_sim.orchestrator import EPISODE_RE, create_app


def client(tmp_path, secret: str = "") -> TestClient:
    return TestClient(create_app(Settings(sim_data_dir=str(tmp_path), sim_shared_secret=secret)))


def test_healthz_and_robots(tmp_path) -> None:
    with client(tmp_path) as c:
        assert c.get("/healthz").json() == {"status": "ok", "sessions": 0}
        robots = c.get("/robots").json()
        assert len(robots) == 25 and {"id", "cameras", "battery_wh", "drive"} <= robots[0].keys()


def test_unknown_robot_404(tmp_path) -> None:
    with client(tmp_path) as c:
        assert c.post("/sessions", json={"robot_id": "nope"}).status_code == 404
        assert c.get("/sessions/zzz").status_code == 404
        assert c.get("/sessions").json() == []


def test_bearer_auth(tmp_path) -> None:
    with client(tmp_path, "s3cret") as c:
        assert c.get("/healthz").status_code == 200
        assert c.get("/robots").status_code == 401
        assert c.get("/robots", headers={"Authorization": "Bearer wrong"}).status_code == 401
        assert c.get("/robots", headers={"Authorization": "Bearer s3cret"}).status_code == 200
        assert c.post("/sessions", json={"robot_id": "nope"}).status_code == 401


@pytest.mark.parametrize("name", ["../x.mcap", "a/b.mcap", "x.txt", ".mcap", "x.mcap/"])
def test_episode_name_regex_rejects(name: str) -> None:
    assert not EPISODE_RE.match(name)


def test_episode_download_validation(tmp_path, menagerie_settings) -> None:
    s = Settings(sim_data_dir=str(tmp_path), sim_cameras_enabled=False, sim_foxglove_enabled=False,
                 sim_session_port_base=18100)  # fmt: skip
    with TestClient(create_app(s)) as c:
        sid = c.post("/sessions", json={"robot_id": "franka_fr3"}).json()["id"]
        assert c.get(f"/sessions/{sid}/episodes").json() == []
        assert c.get(f"/sessions/{sid}/episodes/..%2Fx.mcap").status_code in (400, 404)
        assert c.get(f"/sessions/{sid}/episodes/other-1.mcap").status_code == 400
        assert c.get(f"/sessions/{sid}/episodes/franka_fr3-1.mcap").status_code == 404
        (tmp_path / "episodes").mkdir()
        (tmp_path / "episodes" / "franka_fr3-1.mcap").write_bytes(b"x")
        assert c.get(f"/sessions/{sid}/episodes/franka_fr3-1.mcap").content == b"x"
        assert c.delete(f"/sessions/{sid}").status_code == 204
