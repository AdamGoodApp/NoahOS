from __future__ import annotations

import numpy as np

from noahos.sim.v1 import sim_pb2 as pb
from noahos_sim.models import LoadedModel
from noahos_sim.session.physics import SimCore


def run(core: SimCore, steps: int) -> None:
    with core.lock:
        for _ in range(steps):
            core.step()


def test_telemetry_round_trip_and_lengths(fr3: LoadedModel) -> None:
    core = SimCore(fr3)
    run(core, 100)
    with core.lock:
        tel = core.telemetry(0.0)
    back = pb.Telemetry.FromString(tel.SerializeToString())
    n = len(core.robot_spec().joints)
    assert n >= 7
    for field in ("qpos", "qvel", "torque", "power_w", "motor_temp_c", "target"):
        assert len(getattr(back, field)) == n, field
    assert back.seq == 1 and back.mode == pb.MODE_MANUAL
    assert not back.HasField("base")  # fixed-base arm
    assert not back.HasField("battery_percent")  # mains
    assert back.total_power_w >= 0


def test_out_of_range_targets_are_clamped(fr3: LoadedModel) -> None:
    core = SimCore(fr3)
    # While the task runs, targets are refused and the robot stays on its task.
    core.set_mode(pb.MODE_AUTO)
    denied = core.set_targets([0], [0.1])
    assert denied[0].kind == pb.EVENT_KIND_DENIED and core.mode == pb.MODE_AUTO
    core.set_mode(pb.MODE_MANUAL)
    assert core.set_targets([0, 1, 999], [1e6, -1e6, 5.0]) == []
    assert core.manual[0] == core.hi[0] and core.manual[1] == core.lo[1]
    core.set_targets([0], [float("nan")])
    assert np.isfinite(core.manual).all()


def test_estop_freezes_targets_at_qpos(fr3: LoadedModel) -> None:
    core = SimCore(fr3)
    run(core, 200)
    assert core.estop()[0].mode == pb.MODE_STOPPED
    with core.lock:
        np.testing.assert_allclose(core.stopped, core.data.qpos[core.qadr])
    assert core.estop() == []  # idempotent
    denied = core.set_targets([0], [0.1])
    assert denied[0].kind == pb.EVENT_KIND_DENIED and core.mode == pb.MODE_STOPPED
    run(core, 10)
    np.testing.assert_allclose(core.targets, core.stopped)
    core.set_mode(pb.MODE_MANUAL)  # resume
    assert core.mode == pb.MODE_MANUAL


def test_mode_transitions(fr3: LoadedModel) -> None:
    core = SimCore(fr3)
    core.set_mode(pb.MODE_MANUAL)
    assert core.set_mode(pb.MODE_AUTO)[0].mode == pb.MODE_AUTO
    assert core.set_mode(pb.MODE_AUTO) == []
    assert core.set_mode(pb.MODE_STOPPED) == []


def test_new_session_holds_its_pose(fr3: LoadedModel) -> None:
    """Going live must not start the task: a new session is in Manual hold and its joints do not sweep."""
    core = SimCore(fr3)
    assert core.mode == pb.MODE_MANUAL
    start = core.targets.copy()
    run(core, 1000)  # 2 s
    np.testing.assert_allclose(core.targets, start)
    with core.lock:
        np.testing.assert_allclose(core.data.qpos[core.qadr], start, atol=0.05)
    assert core.task_t == 0.0
