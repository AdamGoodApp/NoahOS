// XY pad: the selected joint's turning plane, flattened. For a hinge the handle points where the part points
// on screen (same as the control wheel) and dragging it turns the part after the pointer; for a slide joint
// the handle's height sets the position.
import { useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react'

import type { JointInfo } from './control-state'
import { aimAngle, clamp, DEFAULT_AIM, pointerAngle, slideFraction, slideLimits, slideValue, turnToward, type AimStore } from './joint-control'

const HALF = 40
const GRID = Array.from({ length: 17 }, (_, i) => 10 + i * 5)
const DEG = Math.PI / 180
/** Pointer closer to O than this (fraction of the pad's half-width) has no usable direction. */
const DEAD_ZONE = 0.05

/** Inverse-kinematics drag of the selected part; set when the pad's "All joints follow" toggle is on. */
export type PadFollow = { begin(): boolean; move(u: number, v: number): void; end(): void }

type Props = {
  joint: JointInfo
  value: number
  aimStore: AimStore
  valueText: string
  onChange(value: number, phase: 'move' | 'end'): void
  follow: PadFollow | null
}

/** Keyboard nudge of the followed part, as a share of a full pad deflection. */
const FOLLOW_STEP = 0.05
/** Arrow keys nudge the followed part across the screen (u right, v down). */
const FOLLOW_KEYS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

export function JointPad({ joint, value, aimStore, valueText, onChange, follow }: Props) {
  const aim = useSyncExternalStore(aimStore.subscribe, aimStore.get, () => DEFAULT_AIM)
  const ref = useRef<SVGSVGElement>(null)
  const drag = useRef<{ id: number; value: number; angle: number | null } | null>(null)
  // How far from O the handle sits (0–1); only the direction drives a hinge.
  const [reach, setReach] = useState(0.45)
  // Follow mode: where the pointer pressed and how far the handle is pulled from O.
  const followDrag = useRef<{ id: number; u0: number; v0: number } | null>(null)
  const [pull, setPull] = useState<{ u: number; v: number } | null>(null)

  let hx = 50
  let hy = 50
  if (follow) {
    hx = 50 + HALF * (pull?.u ?? 0)
    hy = 50 + HALF * (pull?.v ?? 0)
  } else if (joint.type === 'hinge') {
    const a = aimAngle(aim, value)
    hx = 50 + HALF * reach * Math.sin(a)
    hy = 50 - HALF * reach * Math.cos(a)
  } else {
    hy = 50 + HALF - 2 * HALF * slideFraction(joint, value)
  }

  /** Pointer in pad units: (0, 0) at O, ±1 at the edge of the dot field. */
  const local = (e: PointerEvent<SVGSVGElement>) => {
    const rect = ref.current!.getBoundingClientRect()
    return {
      u: (((e.clientX - rect.left) / rect.width) * 100 - 50) / HALF,
      v: (((e.clientY - rect.top) / rect.height) * 100 - 50) / HALF,
    }
  }

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    // No text selection while dragging.
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    const { u, v } = local(e)
    if (follow) {
      // The part moves by how far the pointer travels from where it pressed, in the screen's plane.
      if (!follow.begin()) return
      followDrag.current = { id: e.pointerId, u0: u, v0: v }
      setPull({ u: 0, v: 0 })
      return
    }
    if (joint.type === 'slide') {
      const next = slideValue(joint, 0.5 - v / 2)
      drag.current = { id: e.pointerId, value: next, angle: null }
      onChange(next, 'move')
      return
    }
    drag.current = { id: e.pointerId, value, angle: null }
    if (Math.hypot(u, v) < DEAD_ZONE) return
    // Pressing turns the part toward the pointer's direction.
    const angle = pointerAngle(u, v)
    setReach(Math.min(Math.hypot(u, v), 1))
    drag.current.value = turnToward(value, aim.sense, aimAngle(aim, value), angle, joint.range)
    drag.current.angle = angle
    onChange(drag.current.value, 'move')
  }
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const f = followDrag.current
    if (f?.id === e.pointerId && follow) {
      const { u, v } = local(e)
      const next = { u: clamp(u - f.u0, -1, 1), v: clamp(v - f.v0, -1, 1) }
      setPull(next)
      follow.move(next.u, next.v)
      return
    }
    const d = drag.current
    if (d?.id !== e.pointerId) return
    const { u, v } = local(e)
    if (joint.type === 'slide') {
      d.value = slideValue(joint, 0.5 - v / 2)
    } else {
      if (Math.hypot(u, v) < DEAD_ZONE) return
      const angle = pointerAngle(u, v)
      setReach(Math.min(Math.hypot(u, v), 1))
      // Follow the pointer's turn since the last move (the part's own direction lags a frame behind).
      d.value = turnToward(d.value, aim.sense, d.angle ?? aimAngle(aim, d.value), angle, joint.range)
      d.angle = angle
    }
    onChange(d.value, 'move')
  }
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    if (followDrag.current?.id === e.pointerId) {
      follow?.end()
      followDrag.current = null
      setPull(null)
      return
    }
    if (drag.current?.id !== e.pointerId) return
    onChange(drag.current.value, 'end')
    drag.current = null
  }

  const step = joint.type === 'hinge' ? DEG : 0.001
  const [lo, hi] = joint.type === 'hinge' ? (joint.range ?? [-Math.PI, Math.PI]) : slideLimits(joint)
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const big = e.shiftKey ? 10 : 1
    if (follow) {
      const dir = Object.hasOwn(FOLLOW_KEYS, e.key) ? FOLLOW_KEYS[e.key] : undefined
      if (!dir) return
      e.preventDefault()
      if (!follow.begin()) return
      follow.move(dir[0] * FOLLOW_STEP * big, dir[1] * FOLLOW_STEP * big)
      follow.end()
      return
    }
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step * big
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step * big
    else if (e.key === 'Home') next = lo
    else if (e.key === 'End') next = hi
    if (next === null) return
    e.preventDefault()
    onChange(clamp(next, lo, hi), 'end')
  }

  return (
    <svg
      ref={ref}
      className="joint-pad"
      viewBox="0 0 100 100"
      role="slider"
      tabIndex={0}
      aria-label={`${joint.name} control pad`}
      aria-valuemin={lo}
      aria-valuemax={hi}
      aria-valuenow={value}
      aria-valuetext={valueText}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    >
      {GRID.flatMap((x) =>
        GRID.map((y) => {
          const d2 = (x - hx) ** 2 + (y - hy) ** 2
          return (
            <circle
              key={`${x}-${y}`}
              className="joint-pad__dot"
              cx={x}
              cy={y}
              r={0.6 + 1.7 * Math.exp(-d2 / 110)}
              opacity={0.3 + 0.55 * Math.exp(-d2 / 220)}
            />
          )
        }),
      )}
      <text className="joint-pad__label" x={50} y={5} textAnchor="middle">X</text>
      <text className="joint-pad__label" x={50} y={98.5} textAnchor="middle">Z</text>
      <text className="joint-pad__label" x={2} y={51.5}>YL</text>
      <text className="joint-pad__label" x={98} y={51.5} textAnchor="end">YR</text>
      <circle className="joint-pad__origin" cx={50} cy={50} r={1.8} />
      <circle className="joint-pad__handle" cx={hx} cy={hy} r={2.6} />
    </svg>
  )
}
