import { Time } from '@carbon/icons-react'

import type { Welcome } from '@/gen/noahos/sim/v1/sim_pb'
import type { LiveState } from '@/lib/live/client'
import { STATUS_LABEL, formatAge, type Robot, type RobotStatus } from './fleet-data'

/** Carbon status icons: fault = failed, online = succeeded, charging = in progress, idle = not started, offline = unknown. */
export const STATUS_KIND = {
  fault: 'failed',
  online: 'succeeded',
  charging: 'in-progress',
  idle: 'not-started',
  offline: 'unknown',
} as const satisfies Record<RobotStatus, string>

export function statusText(r: Robot) {
  return r.operator ? `${STATUS_LABEL[r.status]} · ${r.operator}` : STATUS_LABEL[r.status]
}

export function AgeReading({ robot: r, stale }: { robot: Robot; stale: boolean }) {
  return (
    <span className={stale ? 'robot-age robot-age--stale' : 'robot-age'}>
      <Time size={16} aria-hidden />
      {stale ? `Last seen ${formatAge(r.lastSeenSec)}` : formatAge(r.lastSeenSec)}
    </span>
  )
}

export type HealthCheck = { name: string; kind: 'succeeded' | 'failed' | 'caution-minor' | 'unknown'; label: string }

/** Joints sitting on a range edge (within 1e-3 rad or m). */
function limitCount(welcome: Welcome, qpos: number[]): number {
  return (welcome.robot?.joints ?? []).filter((j, i) => {
    const q = qpos[i]
    return j.limited && q !== undefined && (Math.abs(q - j.rangeMin) <= 1e-3 || Math.abs(q - j.rangeMax) <= 1e-3)
  }).length
}

/**
 * Robot health: live values from the sim while live; a lost live link says so; otherwise placeholders that follow the
 * dashboard status.
 */
export function healthChecks(robot: Robot, live: LiveState): HealthCheck[] {
  const welcome = live.status === 'live' ? live.welcome : null
  if (welcome) {
    const t = live.telemetry
    const atLimit = t ? limitCount(welcome, t.qpos) : 0
    const camerasPublished = welcome.cameras.filter((c) => c.sfuSessionId).length
    const { quality, rttMs } = live.stats
    return [
      quality === 'lost'
        ? { name: 'Comms ⇋ Robot', kind: 'failed', label: 'Disconnected' }
        : { name: 'Comms ⇋ Robot', kind: 'succeeded', label: rttMs === null ? 'Live' : `RTT ${Math.round(rttMs)} ms` },
      atLimit
        ? { name: 'Joints', kind: 'caution-minor', label: `${atLimit} at limit` }
        : { name: 'Joints', kind: 'succeeded', label: 'OK' },
      {
        name: 'Sensors',
        kind: camerasPublished ? 'succeeded' : 'caution-minor',
        label: `Cameras ${camerasPublished}/${welcome.cameras.length}`,
      },
      t?.batteryPercent === undefined
        ? { name: 'Power', kind: 'succeeded', label: 'Mains' }
        : { name: 'Battery', kind: t.batteryPercent < 20 ? 'caution-minor' : 'succeeded', label: `${Math.round(t.batteryPercent)}%` },
    ]
  }
  if (live.status === 'reconnecting' || live.status === 'error') {
    return [
      { name: 'Comms ⇋ Robot', kind: 'failed', label: live.status === 'reconnecting' ? 'Reconnecting' : 'Disconnected' },
      { name: 'Joints', kind: 'unknown', label: 'Unknown' },
      { name: 'Sensors', kind: 'unknown', label: 'Unknown' },
      { name: 'Power', kind: 'unknown', label: 'Unknown' },
    ]
  }
  const offline = robot.status === 'offline'
  const ok: Omit<HealthCheck, 'name'> = offline ? { kind: 'unknown', label: 'Unknown' } : { kind: 'succeeded', label: 'OK' }
  const comms: Omit<HealthCheck, 'name'> = offline ? { kind: 'unknown', label: formatAge(robot.lastSeenSec) } : ok
  const joints: Omit<HealthCheck, 'name'> = robot.status === 'fault' ? { kind: 'failed', label: robot.activity } : ok
  return [
    { name: 'Comms ⇋ Robot', ...comms },
    { name: 'Joints', ...joints },
    { name: 'Sensors', ...ok },
    { name: robot.battery === null ? 'Power' : 'Battery', ...ok },
  ]
}
