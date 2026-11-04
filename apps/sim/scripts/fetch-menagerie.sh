#!/usr/bin/env bash
# Full (texture-complete) Menagerie checkout for native dev, tests and CI.
# The Docker image does the same at build time (Dockerfile). Usage: scripts/fetch-menagerie.sh [dest]
set -euo pipefail
COMMIT=f3b6013629c7b94f8ee93fd977b161fa8350f9bc
DEST=${1:-"$(cd "$(dirname "$0")/.." && pwd)/.menagerie"}
ROBOTS="unitree_g1 unitree_h1 robotis_op3 google_robot hello_robot_stretch unitree_a1 unitree_go1 unitree_go2 anybotics_anymal_b anybotics_anymal_c google_barkour_v0 google_barkour_vb boston_dynamics_spot franka_emika_panda franka_fr3 universal_robots_ur5e universal_robots_ur10e kuka_iiwa_14 ufactory_xarm7 rethink_robotics_sawyer ufactory_lite6 trossen_vx300s trossen_wx250s aloha unitree_z1"
if [ -f "$DEST/.commit" ] && [ "$(cat "$DEST/.commit")" = "$COMMIT" ]; then echo "menagerie up to date at $DEST"; exit 0; fi
rm -rf "$DEST"
git clone --filter=blob:none --no-checkout https://github.com/google-deepmind/mujoco_menagerie "$DEST"
cd "$DEST"
git sparse-checkout init --cone
# shellcheck disable=SC2086
git sparse-checkout set $ROBOTS
git checkout -q "$COMMIT"
rm -rf .git
echo "$COMMIT" > .commit
echo "menagerie at $DEST"
