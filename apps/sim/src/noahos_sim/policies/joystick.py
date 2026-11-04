"""Learned joystick locomotion from MuJoCo Playground (ONNX), run on the Menagerie models.

The policies were trained with other joint gains, damping, armature and friction than the Menagerie models carry;
`start` applies the training values and `stop` restores the model's. A fixed patrol replaces the joystick.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import mujoco
import numpy as np
import onnxruntime as rt

from ..models import LoadedModel
from .base import Policy, PolicySpec

CTRL_DT = 0.02
ACTION_SCALE = 0.5
# (seconds, vx m/s, vy m/s, wz rad/s): forward, turn around, forward, turn around. Inside both training ranges.
PATROL = ((2.0, 0.5, 0.0, 0.0), (3.0, 0.0, 0.0, 1.0), (2.0, 0.5, 0.0, 0.0), (3.0, 0.0, 0.0, 1.0))
PATROL_S = sum(seg[0] for seg in PATROL)
ONNX_DIR = Path(__file__).with_name("onnx")

WALK_SPEC = PolicySpec(
    "walk",
    "Joystick walk",
    "Learned gait from MuJoCo Playground on the floor: walks forward 2 s, turns around 3 s, repeats (10 s cycle)",
    PATROL_S,
)


@dataclass(frozen=True)
class JointPhysics:
    damping: float
    armature: float
    frictionloss: float
    kp: float


class JoystickPolicy(Policy):
    holds_base = False

    def __init__(
        self,
        lm: LoadedModel,
        spec: PolicySpec,
        onnx_file: str,
        imu_site: str,
        default_angles: tuple[float, ...],
        start_height: float,
        physics_of: Callable[[str], JointPhysics],
        gait_hz: float | None,
    ) -> None:
        if not lm.has_base or lm.robot.drive != "servo":
            raise ValueError(f"{lm.robot.id}: a walking policy needs a free base and the servo drive")
        self.spec = spec
        self.model = model = lm.model
        n = len(lm.joints)
        self.qadr, self.dadr = lm.qadr, lm.dadr
        self.base_qadr, self.base_dadr = lm.base_qadr, lm.base_dadr
        self.site = model.site(imu_site).id
        self.default = np.array(default_angles, dtype=float)
        if len(self.default) != n:
            raise ValueError(f"{lm.robot.id}: {len(self.default)} default angles for {n} joints")
        by_joint = {a.joint: a.id for a in lm.actuators}
        if len(by_joint) != n:
            raise ValueError(f"{lm.robot.id}: every joint must be actuated to walk")
        self.act = np.array([by_joint[i] for i in range(n)], dtype=int)
        self.start_height = start_height
        self.gait_hz = gait_hz

        so = rt.SessionOptions()
        so.intra_op_num_threads = 1
        so.inter_op_num_threads = 1
        so.log_severity_level = 3
        self.session = rt.InferenceSession(str(ONNX_DIR / onnx_file), so, providers=["CPUExecutionProvider"])
        if self.session.get_inputs()[0].name != "obs" or self.session.get_outputs()[0].name != "continuous_actions":
            raise ValueError(f"{onnx_file}: expected input 'obs' and output 'continuous_actions'")
        self.obs_dim = int(self.session.get_inputs()[0].shape[1])
        self.n_substeps = round(CTRL_DT / model.opt.timestep)

        self.profile = [physics_of(j.name) for j in lm.joints]
        self.saved = (
            model.dof_damping[self.dadr].copy(),
            model.dof_armature[self.dadr].copy(),
            model.dof_frictionloss[self.dadr].copy(),
            model.actuator_gainprm[self.act].copy(),
            model.actuator_biasprm[self.act].copy(),
        )

        self._reset()
        tmp = mujoco.MjData(model)
        mujoco.mj_forward(model, tmp)
        got = len(self.obs(tmp, np.zeros(3, dtype=np.float32)))
        if got != self.obs_dim:
            raise ValueError(f"{onnx_file}: observation has {got} values, the policy expects {self.obs_dim}")

    def _reset(self) -> None:
        self.last_action = np.zeros(len(self.default), dtype=np.float32)
        self.counter = 0
        self.phase = np.array([0.0, np.pi])
        self.now = self.default.copy()

    def start(self, model: mujoco.MjModel, data: mujoco.MjData) -> None:
        a = self.base_qadr
        data.qpos[a : a + 7] = [0.0, 0.0, self.start_height, 1.0, 0.0, 0.0, 0.0]
        data.qpos[self.qadr] = self.default
        data.qvel[:] = 0.0
        data.ctrl[:] = 0.0
        data.ctrl[self.act] = self.default
        mujoco.mj_forward(model, data)
        for d, act, p in zip(self.dadr, self.act, self.profile, strict=True):
            model.dof_damping[d] = p.damping
            model.dof_armature[d] = p.armature
            model.dof_frictionloss[d] = p.frictionloss
            model.actuator_gainprm[act, 0] = p.kp
            model.actuator_biasprm[act, 1] = -p.kp
            model.actuator_biasprm[act, 2] = 0.0
        self._reset()

    def stop(self, model: mujoco.MjModel) -> None:
        damping, armature, frictionloss, gain, bias = self.saved
        model.dof_damping[self.dadr] = damping
        model.dof_armature[self.dadr] = armature
        model.dof_frictionloss[self.dadr] = frictionloss
        model.actuator_gainprm[self.act] = gain
        model.actuator_biasprm[self.act] = bias

    def command(self, t: float) -> np.ndarray:
        s = t % PATROL_S
        for dur, vx, vy, wz in PATROL:
            if s < dur:
                return np.array([vx, vy, wz], dtype=np.float32)
            s -= dur
        return np.zeros(3, dtype=np.float32)

    def targets(self, t: float, data: mujoco.MjData | None) -> np.ndarray:
        self.counter += 1
        if self.counter % self.n_substeps == 0:
            obs = self.obs(data, self.command(t))
            action = self.session.run(["continuous_actions"], {"obs": obs.reshape(1, -1)})[0][0]
            self.last_action = action.astype(np.float32)
            self.now = self.default + ACTION_SCALE * self.last_action
            if self.gait_hz:
                self.phase = np.fmod(self.phase + 2 * np.pi * self.gait_hz * CTRL_DT + np.pi, 2 * np.pi) - np.pi
        return self.now

    def _imu(self, data: mujoco.MjData) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(linvel, gyro, gravity) in the IMU site frame, as MuJoCo's velocimeter and gyro sensors compute them."""
        vel = np.zeros(6)
        mujoco.mj_objectVelocity(self.model, data, mujoco.mjtObj.mjOBJ_SITE, self.site, vel, 1)
        gravity = data.site_xmat[self.site].reshape(3, 3).T @ np.array([0.0, 0.0, -1.0])
        return vel[3:], vel[:3], gravity

    def obs(self, data: mujoco.MjData, command: np.ndarray) -> np.ndarray:
        raise NotImplementedError


def _go1_physics(name: str) -> JointPhysics:
    if name.endswith("_calf_joint"):
        return JointPhysics(0.5, 0.005, 1.0, 35.0)
    if name.endswith(("_hip_joint", "_thigh_joint")):
        return JointPhysics(0.5, 0.005, 0.3, 35.0)
    raise ValueError(f"unitree_go1: no training physics for joint {name}")


class Go1Walk(JoystickPolicy):
    def __init__(self, lm: LoadedModel) -> None:
        super().__init__(
            lm,
            WALK_SPEC,
            onnx_file="go1_policy.onnx",
            imu_site="imu",
            default_angles=(0.1, 0.9, -1.8, -0.1, 0.9, -1.8, 0.1, 0.9, -1.8, -0.1, 0.9, -1.8),
            start_height=0.278,
            physics_of=_go1_physics,
            gait_hz=None,
        )

    def obs(self, data: mujoco.MjData, command: np.ndarray) -> np.ndarray:
        linvel, gyro, gravity = self._imu(data)
        angles = data.qpos[self.qadr] - self.default
        return np.hstack([linvel, gyro, gravity, angles, data.qvel[self.dadr], self.last_action, command]).astype(
            np.float32
        )


# (name substrings, damping, armature, kp); frictionloss is 0.1 for every G1 joint.
_G1_PHYSICS = (
    (("hip_pitch", "hip_yaw", "waist_yaw"), 2.0, 0.01017752004, 75.0),
    (("hip_roll", "knee"), 2.0, 0.025101925, 75.0),
    (("ankle_pitch",), 1.0, 0.00721945, 20.0),
    (("ankle_roll",), 0.2, 0.00721945, 2.0),
    (("waist_roll", "waist_pitch"), 2.0, 0.00721945, 75.0),
    (("shoulder_", "elbow"), 2.0, 0.003609725, 75.0),
    (("wrist_roll",), 0.2, 0.003609725, 2.0),
    (("wrist_pitch", "wrist_yaw"), 0.2, 0.00425, 2.0),
)


def _g1_physics(name: str) -> JointPhysics:
    for keys, damping, armature, kp in _G1_PHYSICS:
        if any(k in name for k in keys):
            return JointPhysics(damping, armature, 0.1, kp)
    raise ValueError(f"unitree_g1: no training physics for joint {name}")


class G1Walk(JoystickPolicy):
    def __init__(self, lm: LoadedModel) -> None:
        super().__init__(
            lm,
            WALK_SPEC,
            onnx_file="g1_policy.onnx",
            imu_site="imu_in_pelvis",
            default_angles=(
                *(-0.312, 0, 0, 0.669, -0.363, 0),  # left leg
                *(-0.312, 0, 0, 0.669, -0.363, 0),  # right leg
                *(0, 0, 0.073),  # waist
                *(0.2, 0.2, 0, 0.6, 0, 0, 0),  # left arm
                *(0.2, -0.2, 0, 0.6, 0, 0, 0),  # right arm
            ),
            start_height=0.755,
            physics_of=_g1_physics,
            gait_hz=1.5,
        )

    def obs(self, data: mujoco.MjData, command: np.ndarray) -> np.ndarray:
        linvel, gyro, gravity = self._imu(data)
        angles = data.qpos[self.qadr] - self.default
        return np.hstack(
            [
                linvel,
                gyro,
                gravity,
                command,
                angles,
                data.qvel[self.dadr],
                self.last_action,
                np.cos(self.phase),
                np.sin(self.phase),
            ]
        ).astype(np.float32)
