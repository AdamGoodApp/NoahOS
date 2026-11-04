import type { Dispatch, RefObject } from 'react'
import { flushSync } from 'react-dom'

import { EventKind, Mode, Role } from '@/gen/noahos/sim/v1/sim_pb'
import type { ControlApi, ControlSnapshot, ControlTab, LiveMode, LiveSnapshot } from '@/lib/agent/registry'
import type { LiveClient, LiveState } from '@/lib/live/client'
import type { CameraState } from '@/lib/robot-scene'
import type { CameraWindowsApi, CameraWindowsState } from './camera-rail'
import { restPose, type ControlAction, type ControlState } from './control-state'
import type { RobotViewerHandle } from './robot-viewer'

/** The Control page's latest render values, read by the assistant's ControlApi (assigned every render). */
export type AgentRefs = {
  state: ControlState
  load: { phase: 'loading' } | { phase: 'ready' } | { phase: 'error'; message: string }
  camera: CameraState
  tab: number
  live: LiveState
  canControl: boolean
  editable: boolean
  dispatch: Dispatch<ControlAction>
  cameraWindows: CameraWindowsApi
  setCameraWindows: (state: CameraWindowsState) => void
  setTab: (index: number) => void
}

const TAB_BY_INDEX: Record<number, ControlTab> = { 1: 'control', 3: 'simulation', 4: 'logs' }
const INDEX_BY_TAB: Record<ControlTab, number> = { control: 1, simulation: 3, logs: 4 }

function liveMode(mode: Mode): LiveMode {
  if (mode === Mode.MANUAL) return 'manual'
  if (mode === Mode.AUTO) return 'auto'
  if (mode === Mode.STOPPED) return 'stopped'
  return 'unknown'
}

export function liveSnapshot(live: LiveState): LiveSnapshot {
  const welcome = live.status === 'live' ? live.welcome : null
  return {
    status: live.status,
    error: live.error,
    stopping: live.stopping,
    mode: welcome ? liveMode(live.mode) : 'unknown',
    policy: live.policy,
    role: welcome ? (live.session?.grantedRole === Role.OPERATOR ? 'operator' : 'viewer') : null,
    policies: (welcome?.policies ?? []).map((p) => ({ id: p.id, name: p.name, description: p.description })),
    cameras: (welcome?.cameras ?? []).map((c) => c.name),
    telemetryHz: welcome ? live.stats.hz : null,
    rttMs: live.stats.rttMs,
    events: live.events.slice(-10).map((e) => ({ at: e.at, kind: (EventKind[e.kind] ?? 'UNSPECIFIED').toLowerCase(), message: e.message })),
  }
}

/** Resolves with the live snapshot once `done(state)` holds; rejects after `timeoutMs`. */
function untilLive(client: LiveClient, done: (s: LiveState) => boolean, timeoutMs: number, timeoutMessage: () => string) {
  return new Promise<LiveSnapshot>((resolve, reject) => {
    let unsubscribe = () => {}
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(timeoutMessage()))
    }, timeoutMs)
    const check = () => {
      const s = client.get()
      if (!done(s)) return false
      clearTimeout(timer)
      unsubscribe()
      resolve(liveSnapshot(s))
      return true
    }
    if (!check()) unsubscribe = client.subscribe(() => void check())
  })
}

function lastDenied(client: LiveClient): string | undefined {
  const { events } = client.get()
  for (let i = events.length - 1; i >= 0; i--) if (events[i]?.kind === EventKind.DENIED) return events[i]?.message
  return undefined
}

/** The Control page's capability for the assistant's tools. Reads state through `refs`, so it is created once per robot. */
export function buildControlApi(
  robotId: string,
  client: LiveClient,
  viewer: RefObject<RobotViewerHandle | null>,
  refs: RefObject<AgentRefs | null>,
): ControlApi {
  const r = () => {
    if (!refs.current) throw new Error('The Control page is not ready.')
    return refs.current
  }
  const at = () => Date.now()
  return {
    robotId,
    getState(): ControlSnapshot {
      const { state, load, camera, tab, live, canControl, editable } = r()
      return {
        robotId,
        loadPhase: load.phase,
        loadError: load.phase === 'error' ? load.message : null,
        joints: state.info?.joints ?? [],
        values: state.values,
        selected: state.selected,
        tool: state.tool,
        camera,
        tab: TAB_BY_INDEX[tab] ?? 'control',
        canUndo: state.past.length > 0,
        canRedo: state.future.length > 0,
        editable,
        canControl,
        live: liveSnapshot(live),
      }
    },
    setJoints: (values) => r().dispatch({ type: 'joints', values, commit: true, at: at() }),
    resetPose: () => {
      const { state, dispatch } = r()
      if (state.info) dispatch({ type: 'joints', values: restPose(state.info), commit: true, at: at() })
    },
    select: (body) => r().dispatch({ type: 'select', body }),
    setTool: (tool) => r().dispatch({ type: 'tool', tool }),
    setView: (preset) => viewer.current?.setView(preset),
    setZoom: (percent) => viewer.current?.setZoomPercent(percent),
    // flushSync: the next getState() (e.g. the undo loop's canUndo) already sees the result.
    undo: () => flushSync(() => r().dispatch({ type: 'undo' })),
    redo: () => flushSync(() => r().dispatch({ type: 'redo' })),
    setTab: (tab) => r().setTab(INDEX_BY_TAB[tab]),
    goLive: () => {
      client.connect()
      // Wait for telemetry, not just Welcome: Welcome (possibly the relay's cached copy) can carry a stale mode, and an
      // operator joining a stopped robot is put in Manual hold only once telemetry arrives.
      return untilLive(
        client,
        (s) =>
          s.status === 'error' ||
          (s.status === 'live' &&
            s.welcome !== null &&
            s.telemetry !== null &&
            (s.mode !== Mode.STOPPED || s.session?.grantedRole !== Role.OPERATOR)),
        60_000,
        () => 'Live view did not start within 60 s.',
      )
    },
    stop: () => client.stop(),
    subscribe: (listener) => client.subscribe(listener),
    liveStatus: () => client.get().status,
    takeControl: () => {
      client.takeControl()
      return untilLive(client, (s) => s.session?.grantedRole === Role.OPERATOR, 10_000, () => lastDenied(client) ?? 'Control was not granted')
    },
    play: (policyId) => {
      client.play(policyId)
      return untilLive(
        client,
        (s) => s.mode === Mode.AUTO && s.policy === policyId,
        10_000,
        () => lastDenied(client) ?? 'The policy did not start.',
      )
    },
    hold: () => {
      client.hold()
      return untilLive(client, (s) => s.mode === Mode.MANUAL, 10_000, () => lastDenied(client) ?? 'Manual hold was not confirmed.')
    },
    record: (start, label) => client.record(start, label),
    cameraWindow: (name, action) => {
      const { cameraWindows, setCameraWindows } = r()
      if (action === 'enlarge') cameraWindows.enlarge(name)
      else if (action === 'picture_in_picture') cameraWindows.popOut(name)
      else setCameraWindows({ expanded: null, pips: {} })
    },
  }
}
