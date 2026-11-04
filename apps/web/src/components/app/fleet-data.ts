export type RobotStatus = 'online' | 'charging' | 'idle' | 'fault' | 'offline'

export type RobotCategory = 'Humanoid' | 'Mobile manipulator' | 'Quadruped' | 'Arm'

export type Robot = {
  /** MuJoCo Menagerie model directory; also names the preview image. */
  id: string
  /** URL of the main MJCF file, served from `public/models/menagerie/` (see `scripts/fetch-menagerie.mjs`). */
  modelUrl: string
  /** Model name as listed in the MuJoCo Menagerie gallery. */
  name: string
  category: RobotCategory
  image: string
  site: string
  status: RobotStatus
  /** Battery charge, 0–100; null for robots on mains power (fixed arms). */
  battery: number | null
  /** What the robot is doing now, or why it is stopped. */
  activity: string
  operator: string | null
  /** Seconds since the app last heard from the robot. */
  lastSeenSec: number
}

export const STATUS_LABEL: Record<RobotStatus, string> = {
  online: 'Online',
  charging: 'Charging',
  idle: 'Idle',
  fault: 'Fault',
  offline: 'Offline',
}

export const STATUS_ORDER: RobotStatus[] = ['fault', 'online', 'charging', 'idle', 'offline']

export const CATEGORIES: RobotCategory[] = ['Humanoid', 'Mobile manipulator', 'Quadruped', 'Arm']

export const SITES = ['Tokyo Lab', 'Nagoya Lab', 'Osaka Lab'] as const

/** Model files are downloaded by `scripts/fetch-menagerie.mjs`; not committed. */
const MODEL_BASE = '/models/menagerie'

type Row = [id: string, mjcf: string, name: string, category: RobotCategory, site: string, status: RobotStatus, battery: number | null, activity: string, operator: string | null, lastSeenSec: number]

/**
 * Placeholder fleet until the app reads live robot state: one robot per MuJoCo Menagerie model,
 * excluding bipeds, grippers and hands, drones and biomechanical models.
 * https://mujoco.readthedocs.io/en/stable/models.html
 */
const ROWS: Row[] = [
  // Humanoids
  ['unitree_g1', 'g1.xml', 'Unitree G1', 'Humanoid', 'Tokyo Lab', 'online', 82, 'Walk to kitchen · teleop', 'A. Mori', 1],
  ['unitree_h1', 'h1.xml', 'Unitree H1', 'Humanoid', 'Nagoya Lab', 'charging', 31, 'Docked', null, 7],
  ['robotis_op3', 'op3.xml', 'Robotis OP3', 'Humanoid', 'Osaka Lab', 'idle', 96, 'Waiting for task', null, 14],
  // Mobile manipulators
  ['google_robot', 'robot.xml', 'Google Robot', 'Mobile manipulator', 'Nagoya Lab', 'online', 67, 'Load dishwasher · policy v0.4', null, 2],
  ['hello_robot_stretch', 'stretch.xml', 'Hello Robot Stretch 2', 'Mobile manipulator', 'Tokyo Lab', 'fault', 41, 'Lift motor stalled', 'K. Sato', 4],
  // Quadrupeds
  ['unitree_a1', 'a1.xml', 'Unitree A1', 'Quadruped', 'Osaka Lab', 'online', 58, 'Patrol corridor B', null, 2],
  ['unitree_go1', 'go1.xml', 'Unitree Go1', 'Quadruped', 'Tokyo Lab', 'charging', 18, 'Docked', null, 9],
  ['unitree_go2', 'go2.xml', 'Unitree Go2', 'Quadruped', 'Nagoya Lab', 'online', 73, 'Stair climbing trial · teleop', 'Y. Ito', 1],
  ['anybotics_anymal_b', 'anymal_b.xml', 'ANYbotics ANYmal B', 'Quadruped', 'Osaka Lab', 'offline', 12, 'No connection', null, 2 * 60 * 60 + 14 * 60],
  ['anybotics_anymal_c', 'anymal_c.xml', 'ANYbotics ANYmal C', 'Quadruped', 'Osaka Lab', 'online', 88, 'Inspect plant room', null, 3],
  ['google_barkour_v0', 'barkour_v0.xml', 'Google Barkour v0', 'Quadruped', 'Tokyo Lab', 'idle', 100, 'Waiting for task', null, 21],
  ['google_barkour_vb', 'barkour_vb.xml', 'Google Barkour vB', 'Quadruped', 'Tokyo Lab', 'online', 61, 'Agility course · policy v1.2', null, 2],
  ['boston_dynamics_spot', 'spot.xml', 'Boston Dynamics Spot', 'Quadruped', 'Nagoya Lab', 'online', 54, 'Open door · teleop', 'R. Kato', 1],
  // Arms
  ['franka_emika_panda', 'panda.xml', 'Franka Emika Panda', 'Arm', 'Tokyo Lab', 'online', null, 'Pick and place · policy v0.4', null, 1],
  ['franka_fr3', 'fr3.xml', 'Franka FR3', 'Arm', 'Tokyo Lab', 'online', null, 'Peg insertion · teleop', 'M. Abe', 1],
  ['universal_robots_ur5e', 'ur5e.xml', 'Universal Robots UR5e', 'Arm', 'Osaka Lab', 'idle', null, 'Waiting for task', null, 11],
  ['universal_robots_ur10e', 'ur10e.xml', 'Universal Robots UR10e', 'Arm', 'Osaka Lab', 'fault', null, 'Protective stop', 'K. Sato', 3],
  ['kuka_iiwa_14', 'iiwa14.xml', 'KUKA LBR iiwa14', 'Arm', 'Nagoya Lab', 'online', null, 'Wipe counter · policy v0.4', null, 2],
  ['ufactory_xarm7', 'xarm7.xml', 'UFACTORY xArm7', 'Arm', 'Tokyo Lab', 'online', null, 'Stack blocks · teleop', 'A. Mori', 1],
  ['rethink_robotics_sawyer', 'sawyer.xml', 'Rethink Robotics Sawyer', 'Arm', 'Osaka Lab', 'offline', null, 'No connection', null, 46 * 60],
  ['ufactory_lite6', 'lite6.xml', 'UFACTORY Lite 6', 'Arm', 'Nagoya Lab', 'idle', null, 'Waiting for task', null, 8],
  ['trossen_vx300s', 'vx300s.xml', 'ViperX 300 6DOF', 'Arm', 'Tokyo Lab', 'online', null, 'Fold towel · teleop', 'Y. Ito', 1],
  ['trossen_wx250s', 'wx250s.xml', 'WidowX 250 6DOF', 'Arm', 'Tokyo Lab', 'online', null, 'Sort cups · policy v0.4', null, 2],
  ['aloha', 'aloha.xml', 'ALOHA 2', 'Arm', 'Nagoya Lab', 'online', null, 'Bimanual tie shoelace · teleop', 'R. Kato', 1],
  ['unitree_z1', 'z1.xml', 'Unitree Z1', 'Arm', 'Osaka Lab', 'online', null, 'Calibrating joints', null, 5],
]

export const FLEET: Robot[] = ROWS.map(([id, mjcf, name, category, site, status, battery, activity, operator, lastSeenSec]) => ({
  id,
  modelUrl: `${MODEL_BASE}/${id}/${mjcf}`,
  name,
  category,
  image: `/img/menagerie/${id}.webp`,
  site,
  status,
  battery,
  activity,
  operator,
  lastSeenSec,
}))

/** "4s ago", "12m ago", "2h 14m ago". */
export function formatAge(sec: number): string {
  if (sec < 60) return `${sec}s ago`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m ago`
}
