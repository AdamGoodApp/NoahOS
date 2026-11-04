"""What a policy is to the sim: a named source of joint targets with a cycle clock."""

from __future__ import annotations

from dataclasses import dataclass

import mujoco
import numpy as np


@dataclass(frozen=True)
class PolicySpec:
    id: str
    name: str
    description: str
    period_s: float


class Policy:
    spec: PolicySpec
    # True: the base is pinned at its rest pose (sweep); False: the base is free and the robot stands on the floor.
    holds_base: bool = True

    def start(self, model: mujoco.MjModel, data: mujoco.MjData) -> None:
        """Set the start pose and reset internal state (called when the policy starts playing)."""

    def stop(self, model: mujoco.MjModel) -> None:
        """Undo any model changes made by `start` (called on pause, stop and divergence)."""

    def targets(self, t: float, data: mujoco.MjData | None) -> np.ndarray:
        """Joint targets in LoadedModel.joints order at policy time t (called every physics step)."""
        raise NotImplementedError

    def cycle(self, t: float) -> int:
        return int(t // self.spec.period_s)

    def phase_of(self, t: float) -> float:
        return (t % self.spec.period_s) / self.spec.period_s
