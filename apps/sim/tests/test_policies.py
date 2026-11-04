from __future__ import annotations

from pathlib import Path

import pytest

from noahos.sim.v1 import sim_pb2 as pb
from noahos_sim.config import RobotConfig, Settings
from noahos_sim.models import LoadedModel, load
from noahos_sim.session.physics import SimCore


def test_sweep_policy_play_and_hold(fr3: LoadedModel) -> None:
    core = SimCore(fr3)
    assert [p.spec.id for p in core.policies] == ["sweep"]
    assert core.play("nope")[0].kind == pb.EVENT_KIND_DENIED and core.mode == pb.MODE_MANUAL

    events = core.set_mode(pb.MODE_AUTO, "sweep")
    assert [(e.kind, e.message) for e in events] == [(pb.EVENT_KIND_MODE, "Playing Joint sweep")]
    assert core.mode == pb.MODE_AUTO
    assert core.set_mode(pb.MODE_AUTO) == []  # already playing the selected policy

    with core.lock:
        for _ in range(int(1.0 / core.dt)):
            core.step()
        t = core.telemetry(0.0)
    assert t.policy == "sweep" and t.task_cycle == 0

    core.set_mode(pb.MODE_MANUAL)
    assert core.mode == pb.MODE_MANUAL and core.task_t > 0.9  # pausing keeps the policy clock
    core.play("sweep")
    assert core.task_t == 0.0  # playing again restarts it


def walk(robot_id: str, z_lo: float, z_hi: float, settings: Settings, configs: dict[str, RobotConfig]) -> None:
    pytest.importorskip("onnxruntime")
    if not (Path(settings.menagerie_dir) / robot_id).is_dir():
        pytest.skip(f"{robot_id} not in Menagerie")
    lm = load(configs[robot_id], settings)
    core = SimCore(lm)
    m = lm.model
    hip, dof = lm.actuators[0].id, lm.joints[0].dadr
    gain0, damping0 = float(m.actuator_gainprm[hip, 0]), float(m.dof_damping[dof])
    assert [p.spec.id for p in core.policies] == ["sweep", "walk"]

    events = core.play("walk")
    assert events[0].kind == pb.EVENT_KIND_MODE and core.base_pose is None
    assert m.actuator_gainprm[hip, 0] == (35 if robot_id == "unitree_go1" else 75)  # training gains while playing

    z = lm.base_qadr + 2

    def run_until(t_end: float) -> None:
        with core.lock:
            while core.task_t < t_end:
                core.step()
                height = float(core.data.qpos[z])
                assert z_lo < height < z_hi, f"base height {height:.3f} m at t={core.data.time:.2f} s"

    run_until(2.5)
    assert core.data.qpos[lm.base_qadr] > 0.3  # walked forward along +x during the first 2 s segment
    run_until(10.0)  # one whole patrol: both forward segments and both turns
    assert not core.pending_events

    core.set_mode(pb.MODE_MANUAL)
    assert core.base_pose is not None  # frozen where it stands
    assert m.actuator_gainprm[hip, 0] == gain0 and m.dof_damping[dof] == damping0  # model physics restored


def test_go1_walks(menagerie_settings: Settings, robot_configs: dict[str, RobotConfig]) -> None:
    walk("unitree_go1", 0.15, 0.45, menagerie_settings, robot_configs)


def test_g1_walks(menagerie_settings: Settings, robot_configs: dict[str, RobotConfig]) -> None:
    walk("unitree_g1", 0.55, 0.90, menagerie_settings, robot_configs)
