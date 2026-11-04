from __future__ import annotations

import numpy as np
import pytest

from noahos_sim.config import ThermalConfig
from noahos_sim.session.telemetry import Battery, ThermalModel


def test_constant_torque_converges_to_equilibrium() -> None:
    m = ThermalModel(2, ThermalConfig())
    tau = np.array([30.0, 0.0])
    for _ in range(int(600 / 0.01)):
        m.step(0.01, tau)
    assert m.temp[0] == pytest.approx(m.equilibrium(30.0), abs=0.05)
    assert m.temp[1] == pytest.approx(25.0, abs=0.05)
    assert m.equilibrium(30.0) == pytest.approx(25 + 0.0005 * 900 / 0.02)


def test_zero_torque_cools_to_ambient() -> None:
    m = ThermalModel(1, ThermalConfig(initial_c=90.0))
    for _ in range(int(600 / 0.01)):
        m.step(0.01, np.zeros(1))
    assert m.temp[0] == pytest.approx(25.0, abs=0.05)


def test_temperature_clamped() -> None:
    m = ThermalModel(1, ThermalConfig())
    for _ in range(1000):
        m.step(1.0, np.array([1e5]))
    assert m.temp[0] == 120.0


def test_battery() -> None:
    assert not Battery(0).present
    b = Battery(100.0)
    b.step(3600.0, 80.0)
    assert b.percent == pytest.approx(0.0)
    c = Battery(100.0)
    c.step(36.0, 80.0)
    assert c.percent == pytest.approx(99.0)
