import { useEffect, useState, useSyncExternalStore } from 'react'

import type { Welcome } from '@/gen/noahos/sim/v1/sim_pb'
import { CameraSubscriber, type CameraState } from './cameras'

const IDLE: CameraState = { status: 'idle', message: null, feeds: [] }
const idle = () => IDLE

export type LiveCameras = { state: CameraState; retry(): void }

/**
 * One SFU subscription per page while live, shared by the Simulation tab's dock and the Control tab's camera rail.
 * It restarts whenever the sim republishes (new SFU session ids) and stops when live view ends.
 */
export function useLiveCameras(robotId: string, welcome: Welcome | null): LiveCameras {
  const [subscriber] = useState(() => new CameraSubscriber(robotId))
  const state = useSyncExternalStore(subscriber.subscribe, subscriber.get, idle)
  const cameras = welcome?.cameras ?? []
  const key = cameras.map((c) => `${c.sfuSessionId}/${c.trackName}`).join(',')
  const published = cameras.some((c) => c.sfuSessionId)
  useEffect(() => {
    if (!published) return
    void subscriber.start()
    return () => subscriber.stop()
  }, [subscriber, key, published])
  return { state, retry: () => void subscriber.start() }
}
