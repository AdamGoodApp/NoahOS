from __future__ import annotations

import numpy as np

from noahos_sim.models import JointInfo
from noahos_sim.policies.sweep import JointSweep


def joints() -> list[JointInfo]:
    return [
        JointInfo("h", 0, "hinge", 0, 0, True, -1.0, 1.0, True),
        JointInfo("free_h", 1, "hinge", 1, 1, False, 0.0, 0.0, True),
        JointInfo("s", 2, "slide", 2, 2, True, 0.0, 0.04, True),
        JointInfo("passive", 3, "hinge", 3, 3, True, -2.0, 2.0, False),
    ]


def make(period: float = 8.0) -> JointSweep:
    return JointSweep(joints(), np.array([0.0, 0.3, 0.02, 0.5]), period)


def test_targets_within_ranges_for_three_cycles() -> None:
    task = make()
    js = joints()
    lo = np.array([j.lo if j.limited else -np.inf for j in js])
    hi = np.array([j.hi if j.limited else np.inf for j in js])
    for t in np.arange(0, 3 * task.spec.period_s, 0.01):
        tg = task.targets(float(t), None)
        assert np.all(tg >= lo - 1e-12) and np.all(tg <= hi + 1e-12)


def test_passive_joint_is_not_swept() -> None:
    task = make()
    vals = {task.targets(t, None)[3] for t in (0.0, 1.0, 2.5)}
    assert vals == {0.5}


def test_periodic() -> None:
    task = make(6.0)
    np.testing.assert_allclose(task.targets(1.3, None), task.targets(1.3 + 6.0, None), atol=1e-9)


def test_cycle_and_phase() -> None:
    task = make(8.0)
    assert task.cycle(0.0) == 0 and task.cycle(7.99) == 0 and task.cycle(8.0) == 1 and task.cycle(24.5) == 3
    phases = [task.phase_of(t) for t in np.arange(0, 8.0, 0.1)]
    assert all(b > a for a, b in zip(phases, phases[1:], strict=False))
    assert min(phases) >= 0 and max(phases) < 1
    assert task.phase_of(8.0) < 1e-9
