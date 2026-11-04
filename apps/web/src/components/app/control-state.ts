import type { Tool } from '@/lib/robot-scene'

export type { Tool }

/** "left/base_link" → "Left base link". */
export function humanize(name: string): string {
  const text = name.replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export type JointInfo = {
  name: string
  body: string
  type: 'hinge' | 'slide'
  axis: [number, number, number]
  range: [number, number] | null
}

/** Plain-data description of the loaded model, produced by the viewer. */
export type RobotInfo = {
  joints: JointInfo[]
  /** Rest coordinates of free and ball joints (floating bases), keyed `joint#index`. */
  baseValues: Record<string, number>
}

type Change = { joints: { name: string; from: number; to: number }[]; at: number }

export type ControlState = {
  info: RobotInfo | null
  /** Joint values in radians (hinge) or metres (slide). */
  values: Record<string, number>
  /** Joints being dragged whose change is not in the history yet, with their values before the drag. */
  pending: Record<string, number> | null
  selected: string | null
  tool: Tool
  past: Change[]
  future: Change[]
}

export type ControlAction =
  | { type: 'model-loaded'; info: RobotInfo }
  | { type: 'joint'; name: string; value: number; commit: boolean; at: number }
  /** Several joints at once, e.g. a chain following inverse kinematics. */
  | { type: 'joints'; values: Record<string, number>; commit: boolean; at: number }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'select'; body: string | null }
  | { type: 'tool'; tool: Tool }
  /**
   * Live sim pose replaces the values; no history entry, any in-progress drag is dropped. `resetHistory` (first sync of
   * a live connection or model) clears undo/redo, so undo cannot replay a preview-only edit onto the robot.
   */
  | { type: 'sync'; values: Record<string, number>; resetHistory?: boolean }

/** Consecutive commits to the same joint within this window merge into one undo step. */
const MERGE_MS = 500

export const initialControlState: ControlState = {
  info: null,
  values: {},
  pending: null,
  selected: null,
  tool: 'camera',
  past: [],
  future: [],
}

function clamp(info: RobotInfo | null, name: string, value: number) {
  const range = info?.joints.find((j) => j.name === name)?.range
  return range ? Math.min(Math.max(value, range[0]), range[1]) : value
}

/** Turns the in-progress drag into one undo step (or nothing if every joint is back where it started). */
function commitPending(state: ControlState, at = 0, merge = false): ControlState {
  if (!state.pending) return state
  const joints = Object.entries(state.pending).flatMap(([name, from]) => {
    const to = state.values[name] ?? from
    return from === to ? [] : [{ name, from, to }]
  })
  if (!joints.length) return { ...state, pending: null }
  const last = state.past.at(-1)
  const single = joints.length === 1 ? joints[0]! : undefined
  const lastSingle = last?.joints.length === 1 ? last.joints[0]! : undefined
  const past =
    merge && last && single && lastSingle?.name === single.name && at - last.at < MERGE_MS
      ? [...state.past.slice(0, -1), { joints: [{ ...single, from: lastSingle.from }], at }]
      : [...state.past, { joints, at }]
  return { ...state, pending: null, past, future: [] }
}

function apply(state: ControlState, change: Change, side: 'from' | 'to'): Record<string, number> {
  const values = { ...state.values }
  for (const j of change.joints) values[j.name] = j[side]
  return values
}

/** Same as the Zero pose: 0, or the nearest limit when 0 is outside the joint's range; floating bases at rest. */
export function restPose(info: RobotInfo): Record<string, number> {
  const values: Record<string, number> = { ...info.baseValues }
  for (const j of info.joints) values[j.name] = clamp(info, j.name, 0)
  return values
}

export function controlReducer(state: ControlState, action: ControlAction): ControlState {
  switch (action.type) {
    case 'model-loaded': {
      const values = restPose(action.info)
      return { ...state, info: action.info, values, pending: null, selected: null, past: [], future: [] }
    }
    case 'joint':
      return controlReducer(state, {
        type: 'joints',
        values: { [action.name]: action.value },
        commit: action.commit,
        at: action.at,
      })
    case 'joints': {
      const pending = { ...state.pending }
      const values = { ...state.values }
      for (const [name, value] of Object.entries(action.values)) {
        if (!(name in pending)) pending[name] = values[name] ?? 0
        values[name] = clamp(state.info, name, value)
      }
      const next = { ...state, values, pending }
      // Rapid single-joint commits (number input, arrow keys) merge into one undo step.
      return action.commit ? commitPending(next, action.at, true) : next
    }
    case 'undo': {
      const base = commitPending(state)
      const change = base.past.at(-1)
      if (!change) return base
      return { ...base, values: apply(base, change, 'from'), past: base.past.slice(0, -1), future: [...base.future, change] }
    }
    case 'redo': {
      const base = commitPending(state)
      const change = base.future.at(-1)
      if (!change) return base
      return { ...base, values: apply(base, change, 'to'), past: [...base.past, change], future: base.future.slice(0, -1) }
    }
    case 'select':
      return { ...state, selected: action.body }
    case 'tool':
      return { ...state, tool: action.tool }
    case 'sync': {
      const values = { ...state.values, ...action.values }
      return action.resetHistory ? { ...state, values, pending: null, past: [], future: [] } : { ...state, values, pending: null }
    }
  }
}
