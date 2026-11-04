import { describe, expect, it } from 'vitest'

import { controlReducer, initialControlState, type ControlState, type RobotInfo } from './control-state'

const info: RobotInfo = {
  joints: [
    { name: 'a', body: 'l1', type: 'hinge', axis: [0, 0, 1], range: [-1, 1] },
    { name: 'b', body: 'l2', type: 'hinge', axis: [0, 0, 1], range: null },
  ],
  baseValues: {},
}

function edited(): ControlState {
  let s = controlReducer(initialControlState, { type: 'model-loaded', info })
  s = controlReducer(s, { type: 'joint', name: 'a', value: 0.5, commit: true, at: 1 })
  s = controlReducer(s, { type: 'undo' })
  // A drag in progress: pending holds the pre-drag value.
  return controlReducer(s, { type: 'joint', name: 'b', value: 0.3, commit: false, at: 2000 })
}

describe('sync (live pose)', () => {
  it('replaces values, drops the in-progress drag and leaves undo/redo history alone', () => {
    const before = edited()
    expect(before.pending).not.toBeNull()
    const after = controlReducer(before, { type: 'sync', values: { a: 0.2, b: -0.4, 'base#0': 1 } })
    expect(after.values).toEqual({ a: 0.2, b: -0.4, 'base#0': 1 })
    expect(after.pending).toBeNull()
    expect(after.past).toBe(before.past)
    expect(after.future).toBe(before.future)
    expect(after.future).toHaveLength(1)
  })

  it('keeps values the sim does not report', () => {
    const s = controlReducer(controlReducer(initialControlState, { type: 'model-loaded', info }), {
      type: 'sync',
      values: { a: 0.1 },
    })
    expect(s.values).toEqual({ a: 0.1, b: 0 })
  })
})

describe('sync with resetHistory (first live sync)', () => {
  it('clears undo and redo so a preview edit cannot be replayed onto the robot', () => {
    const before = edited()
    expect(before.past.length + before.future.length).toBeGreaterThan(0)
    const after = controlReducer(before, { type: 'sync', values: { a: 0.2 }, resetHistory: true })
    expect(after.past).toEqual([])
    expect(after.future).toEqual([])
    expect(controlReducer(after, { type: 'undo' }).values).toEqual(after.values)
  })
})
