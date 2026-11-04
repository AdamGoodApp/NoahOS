"""Derived telemetry: modelled motor temperature, battery, and sim performance stats."""

from __future__ import annotations

import time
from collections import deque

import numpy as np
import psutil

from ..config import ThermalConfig

IDLE_W = 20.0


class ThermalModel:
    """First-order model: dT/dt = k_heat·τ² − k_cool·(T − T_ambient). MuJoCo has no temperatures."""

    def __init__(self, n: int, cfg: ThermalConfig) -> None:
        self.cfg = cfg
        self.temp = np.full(n, cfg.initial_c)

    def step(self, dt: float, torque: np.ndarray) -> np.ndarray:
        c = self.cfg
        self.temp += dt * (c.k_heat * torque**2 - c.k_cool * (self.temp - c.ambient_c))
        np.clip(self.temp, 0.0, 120.0, out=self.temp)
        return self.temp

    def equilibrium(self, torque: float) -> float:
        c = self.cfg
        return c.ambient_c + c.k_heat * torque**2 / c.k_cool


class Battery:
    def __init__(self, capacity_wh: float) -> None:
        self.capacity_wh = capacity_wh
        self.energy_wh = 0.0

    @property
    def present(self) -> bool:
        return self.capacity_wh > 0

    def step(self, dt: float, power_w: float) -> None:
        if self.present:
            self.energy_wh += dt * (power_w + IDLE_W) / 3600.0

    @property
    def percent(self) -> float:
        return max(0.0, 100.0 * (1.0 - self.energy_wh / self.capacity_wh)) if self.present else 0.0


class StatsWindow:
    """Rolling one-second statistics for SimStats."""

    def __init__(self) -> None:
        self.steps: deque[tuple[float, float, float]] = deque()  # (wall, sim_time, step_ms)
        self.renders: deque[tuple[float, float]] = deque()
        self._step_ms_sum = 0.0
        self._render_ms_sum = 0.0
        self.rtf = 1.0
        self.cpu = 0.0
        self._proc = psutil.Process()
        self._proc.cpu_percent(None)
        self._cpu_at = time.perf_counter()

    def add_step(self, wall: float, sim_time: float, step_ms: float) -> None:
        self.steps.append((wall, sim_time, step_ms))
        self._step_ms_sum += step_ms
        while self.steps and wall - self.steps[0][0] > 1.0:
            self._step_ms_sum -= self.steps.popleft()[2]
        if not self.steps:
            self._step_ms_sum = 0.0

    def add_render(self, wall: float, ms: float) -> None:
        self.renders.append((wall, ms))
        self._render_ms_sum += ms
        while self.renders and wall - self.renders[0][0] > 1.0:
            self._render_ms_sum -= self.renders.popleft()[1]
        if not self.renders:
            self._render_ms_sum = 0.0

    def snapshot(self, now: float) -> dict[str, float]:
        steps = self.steps
        physics_hz = step_ms = 0.0
        if len(steps) > 1:
            first, last = steps[0], steps[-1]
            span = last[0] - first[0]
            physics_hz = (len(steps) - 1) / span if span > 0 else 0.0
            step_ms = self._step_ms_sum / len(steps)
            if span > 0:
                rtf = (last[1] - first[1]) / span
                self.rtf += 0.3 * (rtf - self.rtf)
        render_ms = self._render_ms_sum / len(self.renders) if self.renders else 0.0
        if now - self._cpu_at >= 1.0:
            self.cpu = self._proc.cpu_percent(None)
            self._cpu_at = now
        return {
            "realtime_factor": self.rtf,
            "physics_hz": physics_hz,
            "step_ms": step_ms,
            "render_ms": render_ms,
            "cpu_percent": self.cpu,
        }
