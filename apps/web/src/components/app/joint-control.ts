// Geometry shared by the control wheel (viewport) and the XY pad (side panel).
// Screen angles are clockwise from "up" (the X label), in radians.
import type { JointInfo } from './control-state'

export const TAU = Math.PI * 2
export const RAD_TO_DEG = 180 / Math.PI

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

/** Slide joints without limits get this travel either side of zero on the pad and wheel (m). */
const UNLIMITED_SLIDE = 0.5

/**
 * Where the controlled part points on screen, reported by the viewer every time it moves:
 * `sense` is +1 when a positive hinge rotation looks clockwise; `angle` is the screen direction from the
 * pivot to the part's centre of mass, or null when that lies on the pivot (e.g. a wrist roll).
 */
export type Aim = { sense: 1 | -1; angle: number | null }

/** Screen direction to draw the handle: the part's direction, else the joint value as a dial (0 = up). */
export const aimAngle = (aim: Aim, value: number) => aim.angle ?? aim.sense * value

/** Angle difference folded into (-π, π]. */
const wrap = (a: number) => a - TAU * Math.round(a / TAU)

/**
 * Turns a hinge so the part follows the pointer from screen angle `from` to `to`, by the shorter way,
 * then clamps to the joint's range. Applied per pointer move, so it never jumps a full turn at the seam.
 */
export function turnToward(value: number, sense: 1 | -1, from: number, to: number, range: JointInfo['range']): number {
  const next = value + sense * wrap(to - from)
  return range ? clamp(next, range[0], range[1]) : next
}

/** True when the joint sits on (or within a hair of) one of its limits. */
export function isAtLimit(joint: JointInfo, value: number): boolean {
  if (!joint.range) return false
  const eps = joint.type === 'hinge' ? 1e-4 : 1e-6
  return value <= joint.range[0] + eps || value >= joint.range[1] - eps
}

export function slideLimits(joint: JointInfo): [number, number] {
  return joint.range ?? [-UNLIMITED_SLIDE, UNLIMITED_SLIDE]
}

/** 0 at the slide's lower limit, 1 at its upper limit. */
export function slideFraction(joint: JointInfo, value: number): number {
  const [lo, hi] = slideLimits(joint)
  return hi > lo ? clamp((value - lo) / (hi - lo), 0, 1) : 0.5
}

export function slideValue(joint: JointInfo, fraction: number): number {
  const [lo, hi] = slideLimits(joint)
  return lo + clamp(fraction, 0, 1) * (hi - lo)
}

/** Point on a circle at a screen angle. */
export function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)]
}

/** SVG arc path from screen angle `a0` clockwise to `a1` (a1 >= a0). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const span = Math.min(a1 - a0, TAU - 1e-4)
  const [x0, y0] = polar(cx, cy, r, a0)
  const [x1, y1] = polar(cx, cy, r, a0 + span)
  return `M ${x0} ${y0} A ${r} ${r} 0 ${span > Math.PI ? 1 : 0} 1 ${x1} ${y1}`
}

/** Pointer angle around a centre, clockwise from up. */
export const pointerAngle = (dx: number, dy: number) => Math.atan2(dx, -dy)

/**
 * The aim changes on nearly every frame while orbiting; keeping it in a tiny store lets only the pad
 * re-render instead of the whole Control page.
 */
export type AimStore = { get(): Aim; set(aim: Aim): void; subscribe(listener: () => void): () => void }

export const DEFAULT_AIM: Aim = { sense: 1, angle: null }

export function createAimStore(): AimStore {
  let current = DEFAULT_AIM
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set(aim) {
      current = aim
      for (const l of listeners) l()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
