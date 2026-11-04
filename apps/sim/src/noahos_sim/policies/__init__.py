"""Policies the operator can play per robot: the generic joint sweep, plus learned walks where one exists."""

from __future__ import annotations

from ..models import LoadedModel
from .base import Policy, PolicySpec
from .joystick import G1Walk, Go1Walk
from .sweep import JointSweep

__all__ = ["Policy", "PolicySpec", "policies_for"]

_LEARNED = {"unitree_go1": Go1Walk, "unitree_g1": G1Walk}


def policies_for(lm: LoadedModel) -> list[Policy]:
    """This robot's policies; ids are unique per robot and the first one is selected at session start."""
    out: list[Policy] = [JointSweep(lm.joints, lm.initial_qpos[lm.qadr])]
    learned = _LEARNED.get(lm.robot.id)
    if learned is not None:
        out.append(learned(lm))
    return out
