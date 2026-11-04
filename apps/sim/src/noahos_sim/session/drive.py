"""Drive modes: turn joint targets into actuator controls (servo) or kinematic poses."""

from __future__ import annotations

import mujoco
import numpy as np

from ..models import LoadedModel


class ServoDrive:
    """Position servos get ctrl = gear·target; plain motors get a software PD each physics step."""

    kind = "servo"

    def __init__(self, lm: LoadedModel) -> None:
        self.lm = lm
        acts = lm.actuators
        self.pos_ids = np.array([a.id for a in acts if a.kind == "position"], dtype=int)
        self.pos_joint = np.array([a.joint for a in acts if a.kind == "position"], dtype=int)
        self.pos_gear = np.array([a.gear for a in acts if a.kind == "position"])
        self.pos_lo = np.array([a.ctrl_lo for a in acts if a.kind == "position"])
        self.pos_hi = np.array([a.ctrl_hi for a in acts if a.kind == "position"])
        mot = [a for a in acts if a.kind == "motor"]
        self.mot_ids = np.array([a.id for a in mot], dtype=int)
        self.mot_joint = np.array([a.joint for a in mot], dtype=int)
        self.mot_kp = np.array([a.kp for a in mot])
        self.mot_kd = np.array([a.kd for a in mot])
        self.mot_lo = np.array([a.ctrl_lo for a in mot])
        self.mot_hi = np.array([a.ctrl_hi for a in mot])
        self.qadr, self.dadr = lm.qadr, lm.dadr

    def step(self, model: mujoco.MjModel, data: mujoco.MjData, targets: np.ndarray) -> None:
        if self.pos_ids.size:
            data.ctrl[self.pos_ids] = np.clip(self.pos_gear * targets[self.pos_joint], self.pos_lo, self.pos_hi)
        if self.mot_ids.size:
            q = data.qpos[self.qadr[self.mot_joint]]
            qd = data.qvel[self.dadr[self.mot_joint]]
            u = self.mot_kp * (targets[self.mot_joint] - q) - self.mot_kd * qd
            data.ctrl[self.mot_ids] = np.clip(u, self.mot_lo, self.mot_hi)
        mujoco.mj_step(model, data)

    def torque(self, data: mujoco.MjData) -> np.ndarray:
        return data.qfrc_actuator[self.dadr]


class KinematicDrive:
    """Actuated joints are placed on their targets; torques come from inverse dynamics."""

    kind = "kinematic"

    def __init__(self, lm: LoadedModel) -> None:
        self.qadr, self.dadr, self.driven = lm.qadr, lm.dadr, lm.actuated
        self.prev: np.ndarray | None = None

    def step(self, model: mujoco.MjModel, data: mujoco.MjData, targets: np.ndarray) -> None:
        dt = model.opt.timestep
        q_idx = self.qadr[self.driven]
        d_idx = self.dadr[self.driven]
        prev = data.qpos[q_idx].copy() if self.prev is None else self.prev
        step_max = 2.0 * dt  # ≤ 2 rad/s (or m/s): a manual target jump is approached, not teleported
        new = prev + np.clip(targets[self.driven] - prev, -step_max, step_max)
        qvel_new = (new - prev) / dt
        qacc_new = (qvel_new - data.qvel[d_idx]) / dt
        data.qpos[q_idx] = new
        data.qvel[d_idx] = qvel_new
        self.prev = new.copy()
        mujoco.mj_forward(model, data)
        data.qacc[d_idx] = qacc_new
        mujoco.mj_inverse(model, data)
        data.time += dt

    def torque(self, data: mujoco.MjData) -> np.ndarray:
        return data.qfrc_inverse[self.dadr]


def make_drive(lm: LoadedModel, kind: str) -> ServoDrive | KinematicDrive:
    return KinematicDrive(lm) if kind == "kinematic" else ServoDrive(lm)
