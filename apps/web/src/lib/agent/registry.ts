import { useEffect, useSyncExternalStore } from 'react'

import type { SortKey, StatusFilter, View } from '@/components/app/fleet-dashboard'
import type { RobotCategory } from '@/components/app/fleet-data'
import type { JointInfo } from '@/components/app/control-state'
import type { LiveStatus } from '@/lib/live/client'
import type { CameraState, Tool, ViewPreset } from '@/lib/robot-scene'

/**
 * Page capabilities the assistant's tools drive. Each page registers its API while mounted;
 * the tools look it up (and wait for it after navigating). A module singleton, not React
 * context: the panel lives at the root, outside the pages' trees.
 */

export type FleetFilters = {
  status: StatusFilter
  sites: string[]
  categories: RobotCategory[]
  operators: string[]
  batteryMin: number
  batteryMax: number
  query: string
  sort: SortKey
  view: View
}

export type FleetApi = {
  getState(): FleetFilters & { counts: Record<StatusFilter, number>; visible: { id: string; name: string }[] }
  setFilters(patch: Partial<FleetFilters>): void
  clear(): void
}

export type LiveMode = 'manual' | 'auto' | 'stopped' | 'unknown'
export type ControlTab = 'control' | 'simulation' | 'logs'

export type LiveSnapshot = {
  status: LiveStatus
  error: string | null
  stopping: boolean
  mode: LiveMode
  policy: string
  role: 'operator' | 'viewer' | null
  policies: { id: string; name: string; description: string }[]
  cameras: string[]
  telemetryHz: number | null
  rttMs: number | null
  /** The last 10 events. */
  events: { at: number; kind: string; message: string }[]
}

export type ControlSnapshot = {
  robotId: string
  loadPhase: 'loading' | 'ready' | 'error'
  loadError: string | null
  joints: JointInfo[]
  values: Record<string, number>
  selected: string | null
  tool: Tool
  camera: CameraState
  tab: ControlTab
  canUndo: boolean
  canRedo: boolean
  editable: boolean
  canControl: boolean
  live: LiveSnapshot
}

export type ControlApi = {
  robotId: string
  getState(): ControlSnapshot
  setJoints(values: Record<string, number>): void
  resetPose(): void
  select(body: string | null): void
  setTool(tool: Tool): void
  setView(preset: ViewPreset): void
  setZoom(percent: number): void
  undo(): void
  redo(): void
  setTab(tab: ControlTab): void
  goLive(): Promise<LiveSnapshot>
  stop(): void
  /** Live client changes, for the panel's Stop button (useSyncExternalStore). */
  subscribe(listener: () => void): () => void
  liveStatus(): LiveStatus
  takeControl(): Promise<LiveSnapshot>
  play(policyId: string): Promise<LiveSnapshot>
  hold(): Promise<LiveSnapshot>
  record(start: boolean, label: string): void
  cameraWindow(name: string, action: 'enlarge' | 'picture_in_picture' | 'close'): void
}

export type Capabilities = { fleet: FleetApi; control: ControlApi }

const current: { [K in keyof Capabilities]?: Capabilities[K] } = {}
const listeners = new Set<() => void>()
const notify = () => {
  for (const l of listeners) l()
}

/** Registers (replacing any previous) and returns an unregister that only clears its own entry. */
export function registerCapability<K extends keyof Capabilities>(kind: K, api: Capabilities[K]): () => void {
  current[kind] = api
  notify()
  return () => {
    if (current[kind] !== api) return
    delete current[kind]
    notify()
  }
}

/** The capability currently registered for `kind`, re-rendering when pages register or leave. */
export function useCapability<K extends keyof Capabilities>(kind: K): Capabilities[K] | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => getCapability(kind),
    () => null,
  )
}

export function getCapability<K extends keyof Capabilities>(kind: K): Capabilities[K] | null {
  return (current[kind] as Capabilities[K] | undefined) ?? null
}

/** Resolves once `kind` is registered and `ready(api)` holds; polls every 100 ms. */
export function waitForCapability<K extends keyof Capabilities>(
  kind: K,
  ready: (api: Capabilities[K]) => boolean = () => true,
  timeoutMs = 30_000,
): Promise<Capabilities[K]> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      const api = getCapability(kind)
      if (api && ready(api)) return resolve(api)
      if (Date.now() >= deadline) return reject(new Error(`${kind} not ready`))
      setTimeout(check, 100)
    }
    check()
  })
}

export function useRegisterCapability<K extends keyof Capabilities>(kind: K, api: Capabilities[K]): void {
  useEffect(() => registerCapability(kind, api), [kind, api])
}
