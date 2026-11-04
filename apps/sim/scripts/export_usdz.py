"""Export USDZ twins (+ joint maps) of the fleet's compiled MuJoCo models.

uv run --group usd python scripts/export_usdz.py --out ../web/public/models/usdz [--robots franka_fr3 ...]
"""

from __future__ import annotations

import argparse
from pathlib import Path

from noahos_sim.config import Settings, robots
from noahos_sim.models import load
from noahos_sim.usdz import export


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--robots", nargs="*", help="robot ids (default: all)")
    args = ap.parse_args()
    cfgs = robots()
    ids = args.robots or list(cfgs)
    s = Settings(sim_cameras_enabled=False, sim_foxglove_enabled=False)
    for rid in ids:
        export(load(cfgs[rid], s), args.out)
        print(rid, (args.out / f"{rid}.usdz").stat().st_size)


if __name__ == "__main__":
    main()
