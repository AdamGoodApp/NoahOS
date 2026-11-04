from __future__ import annotations

import numpy as np
import pytest

from noahos.sim.v1 import sim_pb2 as pb
from noahos_sim.config import Settings, robots
from noahos_sim.models import load
from noahos_sim.session.physics import SimCore

FLOATING = {
    "unitree_g1", "unitree_h1", "robotis_op3", "hello_robot_stretch", "unitree_a1", "unitree_go1",
    "unitree_go2", "anybotics_anymal_b", "anybotics_anymal_c", "google_barkour_v0", "google_barkour_vb",
    "boston_dynamics_spot",
}  # fmt: skip

IDS = sorted(robots())


def test_fleet_size() -> None:
    assert len(IDS) == 25


@pytest.mark.parametrize("rid", IDS)
def test_robot_loads_steps_and_tracks(rid: str, menagerie_settings: Settings) -> None:
    cfg = robots()[rid]
    lm = load(cfg, menagerie_settings)
    for cam in lm.cameras:
        lm.model.camera(cam.name)  # raises KeyError if missing
    assert lm.has_base == (rid in FLOATING)
    assert 2 <= len(lm.cameras) <= 4
    assert any(j.actuated for j in lm.joints)

    core = SimCore(lm)
    core.set_mode(pb.MODE_AUTO)  # track the sweep, not the held start pose
    steps = int(2.0 / core.dt)
    errors = []
    with core.lock:
        for i in range(steps):
            core.step()
            assert np.isfinite(core.data.qpos).all() and np.isfinite(core.data.qvel).all()
            if i == int(1.0 / core.dt):
                errors.append(core.joint_error().max())
    assert not core.pending_events, "physics diverged and was recovered"
    # §5.4 divergence rule: actuated joints within 0.5 rad of target after 1 s.
    assert errors[0] < 0.5, f"{rid}: tracking error {errors[0]:.3f} with drive={core.drive.kind}"


def test_floating_set_matches(menagerie_settings: Settings) -> None:
    found = {rid for rid in IDS if load(robots()[rid], menagerie_settings).has_base}
    assert found == FLOATING
