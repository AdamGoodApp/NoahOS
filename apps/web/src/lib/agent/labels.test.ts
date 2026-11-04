import { describe, expect, it } from 'vitest'

import { stepLabel } from './labels'

describe('stepLabel', () => {
  it('lists the joints a set_joints step moves, with units', () => {
    expect(
      stepLabel('set_joints', {
        joints: [
          { name: 'left_elbow_joint', value: 45 },
          { name: 'lift', value: 0.2, unit: 'm' },
        ],
      }),
    ).toBe('Set joints · left_elbow_joint 45°, lift 0.2 m')
  })

  it('names navigation and policy targets', () => {
    expect(stepLabel('navigate', { to: 'robot', robotId: 'unitree_g1' })).toBe('Open unitree_g1')
    expect(stepLabel('run_policy', { action: 'play', policy: 'Joystick walk' })).toBe('Play Joystick walk')
    expect(stepLabel('run_policy', { action: 'pause' })).toBe('Pause policy')
    expect(stepLabel('live_view', { action: 'take_control' })).toBe('Live view · take control')
  })

  it('falls back to the tool name for other tools and malformed input', () => {
    expect(stepLabel('get_robot_model', {})).toBe('Get robot model')
    expect(stepLabel('set_joints', 'garbage')).toBe('Set joints')
  })
})
