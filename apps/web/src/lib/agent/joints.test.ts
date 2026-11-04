import { describe, expect, it } from 'vitest'

import type { JointInfo } from '@/components/app/control-state'
import { clampToRange, rangeDisplay, resolveJoint, toDisplay, toInternal } from './joints'

const joint = (name: string, type: 'hinge' | 'slide' = 'hinge', range: [number, number] | null = [-2, 2]): JointInfo => ({
  name,
  body: `${name}_link`,
  type,
  axis: [0, 0, 1],
  range,
})

const G1 = [
  joint('left_elbow_joint'),
  joint('right_elbow_joint'),
  joint('left_shoulder_pitch_joint'),
  joint('waist_yaw_joint'),
  joint('lift', 'slide', [0, 1.1]),
]

describe('resolveJoint', () => {
  it('matches exact names and loose spellings', () => {
    expect(resolveJoint(G1, 'waist_yaw_joint')).toEqual({ joint: G1[3] })
    expect(resolveJoint(G1, 'Left elbow')).toEqual({ joint: G1[0] })
    expect(resolveJoint(G1, 'shoulder pitch left')).toEqual({ joint: G1[2] })
  })

  it('refuses ambiguous names and lists the closest joints', () => {
    const result = resolveJoint(G1, 'elbow')
    expect(result).toMatchObject({ error: 'Unknown joint "elbow"' })
    expect('candidates' in result && result.candidates.slice(0, 2)).toEqual(['left_elbow_joint', 'right_elbow_joint'])
  })

  it('reports unknown joints', () => {
    expect(resolveJoint(G1, 'tail')).toMatchObject({ error: 'Unknown joint "tail"' })
  })
})

describe('units', () => {
  it('reads hinge values as degrees unless radians are given', () => {
    expect(toInternal(G1[0]!, 90)).toBeCloseTo(Math.PI / 2)
    expect(toInternal(G1[0]!, 1, 'rad')).toBe(1)
    expect(toDisplay(G1[0]!, Math.PI / 4)).toEqual({ value: 45, unit: 'deg' })
  })

  it('reads slide values as metres and rejects angle units on them (and metres on hinges)', () => {
    expect(toInternal(G1[4]!, 0.5)).toBe(0.5)
    expect(() => toInternal(G1[4]!, 10, 'deg')).toThrow('lift is a slide joint: use m')
    expect(() => toInternal(G1[0]!, 0.1, 'm')).toThrow('left_elbow_joint is a hinge joint: use deg or rad')
    expect(rangeDisplay(G1[4]!)).toEqual([0, 1.1])
  })

  it('clamps to the joint range and says so', () => {
    expect(clampToRange(G1[0]!, 3)).toEqual({ value: 2, clamped: true })
    expect(clampToRange(G1[0]!, -1)).toEqual({ value: -1, clamped: false })
    expect(clampToRange(joint('free', 'hinge', null), 99)).toEqual({ value: 99, clamped: false })
  })
})
