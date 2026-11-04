"""Generic "Joint sweep": every actuated joint sweeps around its initial pose."""

from __future__ import annotations

import math

import mujoco
import numpy as np

from ..models import JointInfo
from .base import Policy, PolicySpec


class JointSweep(Policy):
    def __init__(self, joints: list[JointInfo], center: np.ndarray, period_s: float = 8.0) -> None:
        self.spec = PolicySpec(
            "sweep",
            "Joint sweep",
            "Every actuated joint sweeps ±25 % of its range, phase-shifted along the chain, in an 8 s cycle",
            float(period_s),
        )
        n = len(joints)
        self.lo = np.array([j.lo if j.limited else -np.inf for j in joints])
        self.hi = np.array([j.hi if j.limited else np.inf for j in joints])
        amp = np.zeros(n)
        for i, j in enumerate(joints):
            if not j.actuated:
                continue
            width = j.hi - j.lo
            if j.kind == "hinge":
                amp[i] = min(0.25 * width, 0.6) if j.limited else 0.5
            else:
                amp[i] = 0.25 * width if j.limited else 0.05
        self.amp = amp
        # Shift the centre inward so the whole sweep fits inside the range (amp <= width/4 always fits).
        self.center = np.clip(center.astype(float), self.lo + amp, self.hi - amp)
        self.phase = np.array([2 * math.pi * i / max(n, 1) for i in range(n)])

    def targets(self, t: float, data: mujoco.MjData | None) -> np.ndarray:
        raw = self.center + self.amp * np.sin(2 * math.pi * t / self.spec.period_s + self.phase)
        return np.clip(raw, self.lo, self.hi)
