"""Simulation core (targets, modes, drive, base hold, derived telemetry) and the paced physics thread."""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

import mujoco
import numpy as np

from noahos.sim.v1 import sim_pb2 as pb

from ..models import LoadedModel
from ..policies import policies_for
from .drive import KinematicDrive, make_drive
from .telemetry import Battery, StatsWindow, ThermalModel

log = logging.getLogger(__name__)

MODE_NAMES = {pb.MODE_AUTO: "auto", pb.MODE_MANUAL: "manual", pb.MODE_STOPPED: "stopped"}
BASE_LIFT = 0.35


@dataclass
class SimEvent:
    kind: int
    message: str
    mode: int = pb.MODE_UNSPECIFIED


class SimCore:
    """All mutable sim state. Every public method takes `lock`; the physics thread calls `step`."""

    def __init__(self, lm: LoadedModel) -> None:
        self.lm = lm
        self.model = lm.model
        self.data = mujoco.MjData(self.model)
        self.lock = threading.Lock()
        self.dt = float(self.model.opt.timestep)
        n = len(lm.joints)
        self.n = n
        self.qadr, self.dadr, self.lo, self.hi = lm.qadr, lm.dadr, lm.lo, lm.hi

        self.data.qpos[:] = lm.initial_qpos
        if self.model.nkey and self.model.key_ctrl.size:
            self.data.ctrl[:] = self.model.key_ctrl[0]
        mujoco.mj_forward(self.model, self.data)
        self.base_pose = None
        if lm.has_base:
            # Held base, lifted by BASE_LIFT of its standing height so the legs sweep in the air (STACK.md §5.3).
            self.base_pose = lm.initial_qpos[lm.base_qadr : lm.base_qadr + 7].copy()
            self.base_pose[2] *= 1.0 + BASE_LIFT
            self.data.qpos[lm.base_qadr : lm.base_qadr + 7] = self.base_pose
            mujoco.mj_forward(self.model, self.data)
            # Models without a standing keyframe can start inside the floor: raise until every geom clears it.
            m = self.model
            robot_geoms = m.geom_bodyid != 0
            lowest = float((self.data.geom_xpos[robot_geoms, 2] - m.geom_rbound[robot_geoms]).min())
            if lowest < 0.02:
                self.base_pose[2] += 0.02 - lowest
                self.data.qpos[lm.base_qadr : lm.base_qadr + 7] = self.base_pose
                mujoco.mj_forward(self.model, self.data)
        self.rest_base_pose = None if self.base_pose is None else self.base_pose.copy()

        self.drive = make_drive(lm, lm.robot.drive)
        self.policies = policies_for(lm)
        self.by_id = {p.spec.id: p for p in self.policies}
        self.policy = self.policies[0]
        # A new session holds its initial pose: a policy plays only when the operator starts it (SetMode AUTO).
        self.mode = pb.MODE_MANUAL
        self.task_t = 0.0
        self.targets = self.data.qpos[self.qadr].copy()
        self.manual = self.targets.copy()
        self.stopped = self.targets.copy()
        self.torque = np.zeros(n)
        self.thermal = ThermalModel(n, lm.robot.thermal)
        self.battery = Battery(lm.robot.battery_wh)
        self.stats = StatsWindow()
        self.recording = False
        self.seq = 0
        self.pending_events: list[SimEvent] = []

    # ---- commands (called from the asyncio thread) -------------------------------------------

    def set_targets(self, index: list[int], values: list[float]) -> list[SimEvent]:
        with self.lock:
            # Safety: joints are commanded only in Manual hold; never while a policy plays or after an E-stop.
            if self.mode == pb.MODE_STOPPED:
                return [SimEvent(pb.EVENT_KIND_DENIED, "stopped")]
            if self.mode != pb.MODE_MANUAL:
                return [SimEvent(pb.EVENT_KIND_DENIED, "a policy is playing: pause it to move joints")]
            for i, v in zip(index, values, strict=False):
                if 0 <= i < self.n and np.isfinite(v):
                    self.manual[i] = float(np.clip(v, self.lo[i], self.hi[i]))
            return []

    def set_mode(self, mode: int, policy_id: str = "") -> list[SimEvent]:
        if mode == pb.MODE_AUTO:
            return self.play(policy_id)
        if mode != pb.MODE_MANUAL:
            return []
        with self.lock:
            if self.mode == pb.MODE_MANUAL:
                return []
            self._leave_policy()
            self.manual = self.data.qpos[self.qadr].copy()
            self.mode = pb.MODE_MANUAL
            return [SimEvent(pb.EVENT_KIND_MODE, "Manual hold", pb.MODE_MANUAL)]

    def play(self, policy_id: str) -> list[SimEvent]:
        """Start (or restart) a policy from Manual hold or a stop; empty id = the selected policy."""
        with self.lock:
            policy = self.by_id.get(policy_id or self.policy.spec.id)
            if policy is None:
                return [SimEvent(pb.EVENT_KIND_DENIED, f"unknown policy: {policy_id}")]
            if not policy.holds_base and self.drive.kind != "servo":
                return [SimEvent(pb.EVENT_KIND_DENIED, "walking needs the servo drive")]
            if self.mode == pb.MODE_AUTO and policy is self.policy:
                return []
            self._leave_policy()
            self.policy = policy
            self.task_t = 0.0
            policy.start(self.model, self.data)
            if self.lm.has_base:
                self.base_pose = self.rest_base_pose.copy() if policy.holds_base else None
                if self.base_pose is not None:
                    a, d = self.lm.base_qadr, self.lm.base_dadr
                    self.data.qpos[a : a + 7] = self.base_pose
                    self.data.qvel[d : d + 6] = 0.0
                    mujoco.mj_forward(self.model, self.data)
            self.mode = pb.MODE_AUTO
            return [SimEvent(pb.EVENT_KIND_MODE, f"Playing {policy.spec.name}", pb.MODE_AUTO)]

    def estop(self) -> list[SimEvent]:
        with self.lock:
            if self.mode == pb.MODE_STOPPED:
                return []
            self._leave_policy()
            self.stopped = self.data.qpos[self.qadr].copy()
            self.mode = pb.MODE_STOPPED
            return [SimEvent(pb.EVENT_KIND_MODE, "Emergency stop: holding pose", pb.MODE_STOPPED)]

    def _leave_policy(self) -> None:
        """Stop the playing policy (lock held): restore its physics and freeze the base where it is."""
        if self.mode == pb.MODE_AUTO:
            self.policy.stop(self.model)
        if self.lm.has_base:
            a, d = self.lm.base_qadr, self.lm.base_dadr
            self.base_pose = self.data.qpos[a : a + 7].copy()
            self.data.qvel[d : d + 6] = 0.0

    # ---- physics (called from the physics thread, lock held by caller) ------------------------

    def _current_targets(self) -> np.ndarray:
        if self.mode == pb.MODE_AUTO:
            self.task_t += self.dt
            return self.policy.targets(self.task_t, self.data)
        if self.mode == pb.MODE_MANUAL:
            return self.manual
        return self.stopped

    def step(self) -> None:
        self.targets = self._current_targets()
        self.drive.step(self.model, self.data, self.targets)
        if self.base_pose is not None:
            a, d = self.lm.base_qadr, self.lm.base_dadr
            self.data.qpos[a : a + 7] = self.base_pose
            self.data.qvel[d : d + 6] = 0.0
        if not np.isfinite(self.data.qpos.sum() + self.data.qvel.sum()):
            self._recover()
            return
        self.torque = self.drive.torque(self.data)
        qvel = self.data.qvel[self.dadr]
        self.thermal.step(self.dt, self.torque)
        self.battery.step(self.dt, float(np.abs(self.torque * qvel).sum()))

    def _recover(self) -> None:
        log.error("physics diverged; switching %s to kinematic drive", self.lm.robot.id)
        if self.mode == pb.MODE_AUTO:
            self.policy.stop(self.model)
        mujoco.mj_resetData(self.model, self.data)
        self.data.qpos[:] = self.lm.initial_qpos
        if self.lm.has_base:
            self.base_pose = self.rest_base_pose.copy()
            self.data.qpos[self.lm.base_qadr : self.lm.base_qadr + 7] = self.base_pose
        mujoco.mj_forward(self.model, self.data)
        self.drive = KinematicDrive(self.lm)
        self.mode = pb.MODE_MANUAL
        self.manual = self.data.qpos[self.qadr].copy()
        self.pending_events.append(SimEvent(pb.EVENT_KIND_ERROR, "Physics diverged; switched to kinematic drive"))
        self.pending_events.append(SimEvent(pb.EVENT_KIND_MODE, "Manual hold", pb.MODE_MANUAL))

    def joint_error(self) -> np.ndarray:
        """|target − q| for actuated joints (divergence checks)."""
        return np.abs(self.targets - self.data.qpos[self.qadr])[self.lm.actuated]

    def telemetry(self, now: float) -> pb.Telemetry:
        """Build a Telemetry message (caller holds the lock)."""
        d = self.data
        qvel = d.qvel[self.dadr]
        power = np.abs(self.torque * qvel)
        self.seq += 1
        t = pb.Telemetry(
            seq=self.seq,
            sim_time=float(d.time),
            mode=self.mode,
            qpos=d.qpos[self.qadr].tolist(),
            qvel=qvel.tolist(),
            torque=self.torque.tolist(),
            power_w=power.tolist(),
            motor_temp_c=self.thermal.temp.tolist(),
            target=self.targets.tolist(),
            contacts=int(d.ncon),
            total_power_w=float(power.sum()),
            task_cycle=self.policy.cycle(self.task_t),
            task_phase=self.policy.phase_of(self.task_t),
            recording=self.recording,
            policy=self.policy.spec.id,
            stats=pb.SimStats(**self.stats.snapshot(now)),
        )
        if self.lm.has_base:
            a = self.lm.base_qadr
            x, y, z, qw, qx, qy, qz = d.qpos[a : a + 7].tolist()
            t.base.CopyFrom(pb.Pose(x=x, y=y, z=z, qw=qw, qx=qx, qy=qy, qz=qz))
        if self.battery.present:
            t.battery_percent = self.battery.percent
        return t

    def robot_spec(self) -> pb.RobotSpec:
        return pb.RobotSpec(
            robot_id=self.lm.robot.id,
            joints=[
                pb.JointSpec(
                    name=j.name,
                    kind=pb.JOINT_KIND_HINGE if j.kind == "hinge" else pb.JOINT_KIND_SLIDE,
                    limited=j.limited,
                    range_min=j.lo,
                    range_max=j.hi,
                    actuated=j.actuated,
                    effort_limit=j.effort_limit,
                )
                for j in self.lm.joints
            ],
            base_joint=self.lm.base_joint,
            timestep=self.dt,
        )


class PhysicsThread(threading.Thread):
    """Steps SimCore at 1/timestep with absolute-time pacing; emits Telemetry at telemetry_hz."""

    MAX_CATCH_UP = 10

    def __init__(self, core: SimCore, telemetry_hz: float, on_telemetry: Callable[[pb.Telemetry], None]) -> None:
        super().__init__(name="physics", daemon=True)
        self.core = core
        self.tel_period = 1.0 / telemetry_hz
        self.on_telemetry = on_telemetry
        self._halt = threading.Event()

    def stop(self) -> None:
        self._halt.set()

    def run(self) -> None:
        core = self.core
        dt = core.dt
        nxt = time.perf_counter()
        next_tel = nxt
        while not self._halt.is_set():
            now = time.perf_counter()
            if now < nxt:
                time.sleep(nxt - now)
                continue
            behind = int((now - nxt) / dt)
            if behind > self.MAX_CATCH_UP:
                nxt = now  # re-base instead of spiralling
            with core.lock:
                t0 = time.perf_counter()
                core.step()
                t1 = time.perf_counter()
                core.stats.add_step(t1, float(core.data.time), (t1 - t0) * 1000.0)
                tel = None
                if t1 >= next_tel:
                    next_tel += self.tel_period
                    if next_tel < t1:
                        next_tel = t1 + self.tel_period
                    tel = core.telemetry(t1)
            if tel is not None:
                self.on_telemetry(tel)
            nxt += dt
