import { useEffect, useState, useSyncExternalStore } from 'react'

import type { Telemetry, Welcome } from '@/gen/noahos/sim/v1/sim_pb'
import { coordinateKey } from '@/lib/mjcf/build'
import { IDLE_STATE, LiveClient, type LiveState } from './client'

/** One LiveClient per robot page; closed when the page unmounts or the robot or pairing token changes. */
export function useLiveClient(robotId: string, pairToken = ''): LiveClient {
  const [client, setClient] = useState(() => new LiveClient(robotId, pairToken))
  useEffect(() => {
    if (client.robotId !== robotId || client.pairToken !== pairToken) {
      client.close()
      setClient(new LiveClient(robotId, pairToken))
    }
    return () => client.close()
  }, [client, robotId, pairToken])
  return client
}

const BASE_FIELDS = ['x', 'y', 'z', 'qw', 'qx', 'qy', 'qz'] as const

const idle = () => IDLE_STATE
const noFrame = () => null

/** Slow live state: status, session, mode, events, stats and the newest telemetry at 5 Hz. */
export function useLiveState(client: LiveClient): LiveState {
  return useSyncExternalStore(client.subscribe, client.get, idle)
}

/** Newest telemetry, updated once per animation frame while live. */
export function useLiveFrame(client: LiveClient): Telemetry | null {
  return useSyncExternalStore(client.subscribeFrame, client.getFrame, noFrame)
}

/**
 * Telemetry → the viewer's joint values (rad / m, keyed by joint name), plus the floating base as
 * `coordinateKey(base, k)` for [x, y, z, qw, qx, qy, qz] — the order `baseValues()` uses.
 * `baseName` is the viewer's own free-joint name (unnamed MJCF joints get generated names there).
 * Written into `values` when given, so a caller can layer telemetry over its own (copied) values in one pass.
 */
export function telemetryValues(
  welcome: Welcome,
  t: Telemetry,
  baseName: string | null,
  values: Record<string, number> = {},
): Record<string, number> {
  const joints = welcome.robot?.joints ?? []
  for (let i = 0; i < joints.length; i++) {
    const q = t.qpos[i]
    if (q !== undefined) values[joints[i]!.name] = q
  }
  const b = t.base
  if (baseName && b) {
    for (let k = 0; k < BASE_FIELDS.length; k++) values[coordinateKey(baseName, k)] = b[BASE_FIELDS[k]!]
  }
  return values
}

/** The viewer's free-joint name, from the `name#k` keys of its base values. */
export function baseJointName(baseValues: Record<string, number> | undefined): string | null {
  const key = baseValues ? Object.keys(baseValues)[0] : undefined
  return key ? key.slice(0, key.lastIndexOf('#')) : null
}
