"""Menagerie model loading: MjSpec patching (floor, light, cameras) and robot introspection."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path

import mujoco
import numpy as np

from .config import CameraConfig, RobotConfig, Settings

MAX_CAMERAS = 4
FLOOR = "noahos_floor"


@dataclass
class JointInfo:
    name: str
    id: int
    kind: str  # "hinge" | "slide"
    qadr: int
    dadr: int
    limited: bool
    lo: float
    hi: float
    actuated: bool = False
    effort_limit: float = 0.0  # N·m or N; 0 = the model gives none


@dataclass
class ActuatorInfo:
    id: int
    joint: int  # index into LoadedModel.joints
    kind: str  # "position" | "motor"
    gear: float
    ctrl_lo: float
    ctrl_hi: float
    kp: float = 0.0
    kd: float = 0.0


@dataclass
class LoadedModel:
    robot: RobotConfig
    model: mujoco.MjModel
    joints: list[JointInfo]
    actuators: list[ActuatorInfo]
    base_joint: str
    base_qadr: int
    base_dadr: int
    initial_qpos: np.ndarray
    cameras: list[CameraConfig] = field(default_factory=list)

    @property
    def has_base(self) -> bool:
        return self.base_qadr >= 0

    # Per-joint index and limit arrays, in `joints` order; shared by the core, drives and policies.
    @cached_property
    def qadr(self) -> np.ndarray:
        return np.array([j.qadr for j in self.joints], dtype=int)

    @cached_property
    def dadr(self) -> np.ndarray:
        return np.array([j.dadr for j in self.joints], dtype=int)

    @cached_property
    def lo(self) -> np.ndarray:
        return np.array([j.lo if j.limited else -np.inf for j in self.joints])

    @cached_property
    def hi(self) -> np.ndarray:
        return np.array([j.hi if j.limited else np.inf for j in self.joints])

    @cached_property
    def actuated(self) -> np.ndarray:
        return np.array([j.actuated for j in self.joints], dtype=bool)


def mjcf_path(robot: RobotConfig, menagerie_dir: str) -> Path:
    return Path(menagerie_dir) / robot.id / robot.mjcf


def _xyaxes_quat(xyaxes: list[float]) -> np.ndarray:
    x = np.asarray(xyaxes[:3], dtype=float)
    y = np.asarray(xyaxes[3:], dtype=float)
    x /= np.linalg.norm(x)
    y -= x * np.dot(x, y)
    y /= np.linalg.norm(y)
    z = np.cross(x, y)
    mat = np.stack([x, y, z], axis=1).reshape(-1)
    quat = np.zeros(4)
    mujoco.mju_mat2Quat(quat, mat)
    return quat


def _root_body(model: mujoco.MjModel) -> int:
    for j in range(model.njnt):
        if model.jnt_type[j] == mujoco.mjtJoint.mjJNT_FREE:
            return int(model.jnt_bodyid[j])
    return 1


def _camera_overrides(cam: CameraConfig, s: Settings) -> CameraConfig:
    return cam.model_copy(
        update={
            "fps": s.sim_camera_fps or cam.fps,
            "width": s.sim_camera_width or cam.width,
            "height": s.sim_camera_height or cam.height,
        }
    )


def load(robot: RobotConfig, s: Settings) -> LoadedModel:
    path = mjcf_path(robot, s.menagerie_dir)
    if not path.is_file():
        raise FileNotFoundError(f"MJCF not found: {path} (set MENAGERIE_DIR)")

    # First compile: size the scene (extent, root body position) for camera placement.
    probe = mujoco.MjSpec.from_file(str(path)).compile()
    pdata = mujoco.MjData(probe)
    if probe.nkey:
        mujoco.mj_resetDataKeyframe(probe, pdata, 0)
    mujoco.mj_forward(probe, pdata)
    root = _root_body(probe)
    root_name = probe.body(root).name
    center = pdata.subtree_com[root].copy()
    extent = float(max(probe.stat.extent, 0.4))

    spec = mujoco.MjSpec.from_file(str(path))
    _add_scene(spec)

    # Cameras: generic two, configured extras, then the model's own (no depth cameras); capped at MAX_CAMERAS.
    d = 0.95 * extent
    tp = spec.worldbody.add_camera(name="third_person", fovy=45)
    tp.pos = center + np.array([0.75 * d, -0.65 * d, 0.45 * d])
    tp.mode = mujoco.mjtCamLight.mjCAMLIGHT_TARGETBODYCOM
    tp.targetbody = root_name
    root_spec = spec.body(root_name)
    rear = root_spec.add_camera(name="rear", fovy=60)
    rear.mode = mujoco.mjtCamLight.mjCAMLIGHT_TRACK
    rear.pos = [-0.9 * d, 0.0, 0.35 * d]
    rear.quat = _xyaxes_quat([0, -1, 0, 0.4, 0, 0.9])
    cameras = list(robot.generic_cameras())
    for extra in robot.cameras:
        if extra.body is None:
            continue
        cam = spec.body(extra.body).add_camera(name=extra.name, fovy=70)
        cam.pos = extra.pos or [0, 0, 0]
        if extra.xyaxes:
            cam.quat = _xyaxes_quat(extra.xyaxes)
        cameras.append(extra)
    configured = {c.name for c in cameras}
    for i in range(probe.ncam):
        name = probe.cam(i).name
        if name and name not in configured and "depth" not in name:
            cameras.append(robot.camera_defaults.model_copy(update={"name": name}))
    cameras = [_camera_overrides(c, s) for c in cameras[:MAX_CAMERAS]]

    model = spec.compile()
    return _introspect(robot, model, cameras)


def _add_scene(spec: mujoco.MjSpec) -> None:
    spec.visual.headlight.ambient = [0.4, 0.4, 0.4]
    spec.visual.headlight.diffuse = [0.6, 0.6, 0.6]
    spec.visual.global_.offwidth = max(spec.visual.global_.offwidth, 1280)
    spec.visual.global_.offheight = max(spec.visual.global_.offheight, 960)
    spec.add_texture(
        name="noahos_sky",
        type=mujoco.mjtTexture.mjTEXTURE_SKYBOX,
        builtin=mujoco.mjtBuiltin.mjBUILTIN_GRADIENT,
        rgb1=[0.35, 0.4, 0.45],
        rgb2=[0.05, 0.06, 0.08],
        width=256,
        height=256,
    )
    spec.add_texture(
        name="noahos_grid",
        type=mujoco.mjtTexture.mjTEXTURE_2D,
        builtin=mujoco.mjtBuiltin.mjBUILTIN_CHECKER,
        rgb1=[0.22, 0.24, 0.27],
        rgb2=[0.16, 0.17, 0.19],
        width=300,
        height=300,
    )
    mat = spec.add_material(name="noahos_grid", texrepeat=[6, 6], reflectance=0.1)
    mat.textures[mujoco.mjtTextureRole.mjTEXROLE_RGB] = "noahos_grid"
    spec.worldbody.add_geom(name=FLOOR, type=mujoco.mjtGeom.mjGEOM_PLANE, size=[0, 0, 0.05], material="noahos_grid")
    spec.worldbody.add_light(pos=[0, 0, 4], dir=[0, 0, -1], diffuse=[0.6, 0.6, 0.6], castshadow=False)


def _effort_limit(model: mujoco.MjModel, a: int, jid: int, info: ActuatorInfo) -> float:
    """The largest torque (N·m) or force (N) the model lets this actuator apply at its joint; 0 when unlimited."""
    limits = [0.0]
    if model.actuator_forcelimited[a]:
        limits.append(float(np.abs(model.actuator_forcerange[a]).max()))
    if model.jnt_actfrclimited[jid]:
        limits.append(float(np.abs(model.jnt_actfrcrange[jid]).max()))
    if info.kind == "motor" and model.actuator_ctrllimited[a]:
        limits.append(float(np.abs(model.actuator_ctrlrange[a]).max()) * abs(info.gear))
    return max(limits)


def _introspect(robot: RobotConfig, model: mujoco.MjModel, cameras: list[CameraConfig]) -> LoadedModel:
    joints: list[JointInfo] = []
    by_id: dict[int, int] = {}
    base_joint, base_qadr, base_dadr = "", -1, -1
    for j in range(model.njnt):
        t = int(model.jnt_type[j])
        if t == mujoco.mjtJoint.mjJNT_FREE and base_qadr < 0:
            base_joint = model.joint(j).name or "free_base"
            base_qadr, base_dadr = int(model.jnt_qposadr[j]), int(model.jnt_dofadr[j])
            continue
        if t not in (mujoco.mjtJoint.mjJNT_HINGE, mujoco.mjtJoint.mjJNT_SLIDE):
            continue
        by_id[j] = len(joints)
        joints.append(
            JointInfo(
                name=model.joint(j).name,
                id=j,
                kind="hinge" if t == mujoco.mjtJoint.mjJNT_HINGE else "slide",
                qadr=int(model.jnt_qposadr[j]),
                dadr=int(model.jnt_dofadr[j]),
                limited=bool(model.jnt_limited[j]),
                lo=float(model.jnt_range[j, 0]),
                hi=float(model.jnt_range[j, 1]),
            )
        )

    actuators: list[ActuatorInfo] = []
    for a in range(model.nu):
        if model.actuator_trntype[a] != mujoco.mjtTrn.mjTRN_JOINT:
            continue  # tendon/site transmissions (grippers, wheels) are not commanded
        jid = int(model.actuator_trnid[a, 0])
        if jid not in by_id:
            continue
        position = model.actuator_biastype[a] == mujoco.mjtBias.mjBIAS_AFFINE and model.actuator_biasprm[a, 1] < 0
        limited = bool(model.actuator_ctrllimited[a])
        lo, hi = map(float, model.actuator_ctrlrange[a]) if limited else (-np.inf, np.inf)
        info = ActuatorInfo(
            id=a,
            joint=by_id[jid],
            kind="position" if position else "motor",
            gear=float(model.actuator_gear[a, 0]) or 1.0,
            ctrl_lo=lo,
            ctrl_hi=hi,
        )
        if not position:
            ctrl_max = min(abs(lo), abs(hi)) if limited else 100.0
            info.kp = min(ctrl_max / 0.5, 150.0)
            info.kd = 0.1 * info.kp
        actuators.append(info)
        joint = joints[by_id[jid]]
        joint.actuated = True
        joint.effort_limit = max(joint.effort_limit, _effort_limit(model, a, jid, info))

    qpos = model.key_qpos[0].copy() if model.nkey else model.qpos0.copy()
    for jt in joints:
        if jt.limited:
            qpos[jt.qadr] = np.clip(qpos[jt.qadr], jt.lo, jt.hi)
    return LoadedModel(
        robot=robot,
        model=model,
        joints=joints,
        actuators=actuators,
        base_joint=base_joint,
        base_qadr=base_qadr,
        base_dadr=base_dadr,
        initial_qpos=qpos,
        cameras=cameras,
    )
