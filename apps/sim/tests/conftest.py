from __future__ import annotations

from pathlib import Path

import pytest

from noahos_sim.config import RobotConfig, Settings, robots
from noahos_sim.models import LoadedModel, load


@pytest.fixture(scope="session")
def menagerie_settings() -> Settings:
    s = Settings(sim_cameras_enabled=False, sim_foxglove_enabled=False)
    if not (Path(s.menagerie_dir) / "franka_fr3").is_dir():
        pytest.skip("Menagerie not present (run scripts/fetch-menagerie.sh or set MENAGERIE_DIR)")
    return s


@pytest.fixture(scope="session")
def robot_configs() -> dict[str, RobotConfig]:
    return robots()


@pytest.fixture(scope="session")
def fr3(menagerie_settings: Settings, robot_configs: dict[str, RobotConfig]) -> LoadedModel:
    return load(robot_configs["franka_fr3"], menagerie_settings)
