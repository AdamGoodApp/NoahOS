from __future__ import annotations

from pathlib import Path

import mujoco
import numpy as np
import pytest

pytest.importorskip("pxr")

from noahos_sim.config import RobotConfig, Settings  # noqa: E402
from noahos_sim.models import load  # noqa: E402
from noahos_sim.usdz import export, sanitize, set_pose  # noqa: E402


def test_sanitize_unique_and_valid() -> None:
    taken: set[str] = set()
    assert sanitize("torso", taken, "x") == "torso"
    assert sanitize("torso", taken, "x") == "torso_2"
    assert sanitize("a/b c", taken, "x") == "a_b_c"
    assert sanitize("1st", taken, "x") == "_1st"
    assert sanitize("", taken, "joint3") == "joint3"


@pytest.mark.parametrize("rid", ["franka_fr3", "unitree_g1", "hello_robot_stretch"])
def test_twin_kinematics_match_mujoco(
    rid: str, tmp_path: Path, menagerie_settings: Settings, robot_configs: dict[str, RobotConfig]
) -> None:
    from pxr import Usd, UsdGeom

    lm = load(robot_configs[rid], menagerie_settings)
    spec = export(lm, tmp_path)
    assert [j["name"] for j in spec["joints"]] == [j.name for j in lm.joints]
    assert (tmp_path / f"{rid}.usdz").exists()
    assert (tmp_path / f"{rid}.json").exists()

    rng = np.random.default_rng(0)
    qpos = lm.initial_qpos.copy()
    for j in lm.joints:
        lo, hi = (j.lo, j.hi) if j.limited else (-0.5, 0.5)
        qpos[j.qadr] = rng.uniform(lo, hi)
    if lm.has_base:
        qpos[lm.base_qadr : lm.base_qadr + 3] = rng.uniform(-1, 1, 3)
        q = rng.normal(size=4)
        qpos[lm.base_qadr + 3 : lm.base_qadr + 7] = q / np.linalg.norm(q)

    m = lm.model
    data = mujoco.MjData(m)
    data.qpos[:] = qpos
    mujoco.mj_forward(m, data)

    stage = Usd.Stage.Open(str(tmp_path / f"{rid}.usdz"))
    set_pose(stage, spec, qpos, lm)
    prims = {p.GetName(): p for p in stage.Traverse()}
    root = stage.GetPrimAtPath("/Robot")
    cache = UsdGeom.XformCache()
    body_of = {name: b for b, name in enumerate(spec["bodies"], start=1)}
    assert len(spec["bodies"]) == m.nbody - 1
    # The body's frame (xpos/xmat) includes its joints, so it is the innermost joint prim, else the body prim.
    frame = {n: n for n in body_of}
    for j in spec["joints"]:
        frame[j["body"]] = j["prim"]
    for name, b in ((frame[n], b) for n, b in body_of.items()):
        mat = cache.ComputeRelativeTransform(prims[name], root)[0]
        np.testing.assert_allclose(np.array(mat.ExtractTranslation()), data.xpos[b], atol=1e-5)
        np.testing.assert_allclose(np.array(mat.ExtractRotationMatrix()).T, data.xmat[b].reshape(3, 3), atol=1e-5)
