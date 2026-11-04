import type { JointInfo } from '@/components/app/control-state'

/** Joint-name matching and unit conversion for the assistant's tools. Internal values: radians / metres. */

export type JointUnit = 'deg' | 'rad' | 'm'

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/_joint\b|\bjoint_/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(name: string): string[] {
  return normalize(name).split(' ').filter(Boolean)
}

/** Exact name, then a unique substring match, then a unique joint containing every query token. */
export function resolveJoint(
  joints: JointInfo[],
  query: string,
): { joint: JointInfo } | { error: string; candidates: string[] } {
  const q = normalize(query)
  const exact = joints.find((j) => j.name === query) ?? joints.find((j) => normalize(j.name) === q)
  if (exact) return { joint: exact }
  const unique = (list: JointInfo[]) => (list.length === 1 ? list[0] : undefined)
  const partial = q ? unique(joints.filter((j) => normalize(j.name).includes(q))) : undefined
  if (partial) return { joint: partial }
  const qt = tokens(query)
  const superset = qt.length
    ? unique(joints.filter((j) => qt.every((t) => tokens(j.name).includes(t))))
    : undefined
  if (superset) return { joint: superset }
  const candidates = joints
    .map((j) => ({ name: j.name, score: tokens(j.name).filter((t) => qt.includes(t)).length }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 5)
    .map((c) => c.name)
  return { error: `Unknown joint "${query}"`, candidates }
}

/** User value → internal (radians for hinges, metres for slides). */
export function toInternal(joint: JointInfo, value: number, unit?: JointUnit): number {
  if (joint.type === 'hinge') {
    if (unit === 'm') throw new Error(`${joint.name} is a hinge joint: use deg or rad`)
    return unit === 'rad' ? value : (value * Math.PI) / 180
  }
  if (unit === 'deg' || unit === 'rad') throw new Error(`${joint.name} is a slide joint: use m`)
  return value
}

function round(value: number, step: number): number {
  return Math.round(value / step) * step
}

function displayValue(joint: JointInfo, value: number): number {
  return joint.type === 'hinge' ? Number(round((value * 180) / Math.PI, 0.1).toFixed(1)) : Number(round(value, 0.001).toFixed(3))
}

/** Internal → degrees (0.1) for hinges, metres (0.001) for slides. */
export function toDisplay(joint: JointInfo, value: number): { value: number; unit: 'deg' | 'm' } {
  return { value: displayValue(joint, value), unit: joint.type === 'hinge' ? 'deg' : 'm' }
}

export function rangeDisplay(joint: JointInfo): [number, number] | null {
  return joint.range ? [displayValue(joint, joint.range[0]), displayValue(joint, joint.range[1])] : null
}

export function clampToRange(joint: JointInfo, value: number): { value: number; clamped: boolean } {
  if (!joint.range) return { value, clamped: false }
  const clamped = Math.min(joint.range[1], Math.max(joint.range[0], value))
  return { value: clamped, clamped: clamped !== value }
}
