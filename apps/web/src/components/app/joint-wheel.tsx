// Control wheel drawn over the 3D view, centred on the selected joint's pivot. Client-only (needs the scene).
// For a hinge, the handle sits where the part points on screen; dragging it turns the part after the pointer.
import { useEffect, useRef, useState, type PointerEvent } from 'react'

import type { RobotScene } from '@/lib/robot-scene'
import type { JointInfo } from './control-state'
import { aimAngle, arcPath, DEFAULT_AIM, pointerAngle, polar, slideFraction, slideValue, TAU, turnToward, type Aim } from './joint-control'

const R = 88
/** 16rem; matches `.joint-wheel` in app.scss. */
const SIZE = 2 * (R + 40)
const C = SIZE / 2
/** Re-render when the part's on-screen direction moves by more than this (rad). */
const AIM_EPSILON = 0.01

type Props = {
  scene: RobotScene
  joint: JointInfo
  value: number
  atLimit: boolean
  onChange(value: number, phase: 'move' | 'end'): void
  onAim(aim: Aim): void
}

export function JointWheel({ scene, joint, value, atLimit, onChange, onAim }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [aim, setAim] = useState<Aim>(DEFAULT_AIM)
  const aimRef = useRef(aim)
  const drag = useRef<{ id: number; value: number; angle: number } | null>(null)
  const callbacks = useRef({ onChange, onAim })
  callbacks.current = { onChange, onAim }

  // Follow the pivot every frame without re-rendering React; re-render only when the part's direction changes.
  useEffect(() => {
    return scene.onFrame(() => {
      const root = rootRef.current
      const p = scene.projectJoint(joint.name)
      if (!root) return
      if (!p) {
        root.style.visibility = 'hidden'
        return
      }
      root.style.visibility = 'visible'
      root.style.transform = `translate(${p.x - C}px, ${p.y - C}px)`
      const last = aimRef.current
      const changed =
        p.sense !== last.sense ||
        (p.aim === null) !== (last.angle === null) ||
        (p.aim !== null && last.angle !== null && Math.abs(p.aim - last.angle) > AIM_EPSILON)
      if (changed) {
        const next = { sense: p.sense, angle: p.aim }
        aimRef.current = next
        setAim(next)
        callbacks.current.onAim(next)
      }
    })
  }, [scene, joint.name])

  const pointer = (e: PointerEvent<SVGElement>) => {
    const rect = rootRef.current!.getBoundingClientRect()
    return { dx: e.clientX - (rect.left + C), dy: e.clientY - (rect.top + C) }
  }

  const onPointerDown = (e: PointerEvent<SVGElement>) => {
    if (e.button !== 0) return
    // No text selection or orbiting while turning the joint.
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const { dx, dy } = pointer(e)
    if (joint.type === 'slide') {
      const next = slideValue(joint, 0.5 - dy / (2 * R))
      drag.current = { id: e.pointerId, value: next, angle: 0 }
      callbacks.current.onChange(next, 'move')
      return
    }
    // Pressing elsewhere on the ring turns the part toward that point; pressing the handle does not move it.
    const angle = pointerAngle(dx, dy)
    const next = turnToward(value, aimRef.current.sense, aimAngle(aimRef.current, value), angle, joint.range)
    drag.current = { id: e.pointerId, value: next, angle }
    callbacks.current.onChange(next, 'move')
  }
  const onPointerMove = (e: PointerEvent<SVGElement>) => {
    const d = drag.current
    if (d?.id !== e.pointerId) return
    const { dx, dy } = pointer(e)
    if (joint.type === 'slide') {
      d.value = slideValue(joint, 0.5 - dy / (2 * R))
    } else {
      const angle = pointerAngle(dx, dy)
      d.value = turnToward(d.value, aimRef.current.sense, d.angle, angle, joint.range)
      d.angle = angle
    }
    callbacks.current.onChange(d.value, 'move')
  }
  const onPointerUp = (e: PointerEvent<SVGElement>) => {
    if (drag.current?.id !== e.pointerId) return
    callbacks.current.onChange(drag.current.value, 'end')
    drag.current = null
  }
  const handlers = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }
  const rootClass = atLimit ? 'joint-wheel joint-wheel--limit' : 'joint-wheel'

  const labels = (
    <>
      <text className="joint-wheel__label" x={C} y={C - R - 24} textAnchor="middle">X</text>
      <text className="joint-wheel__label" x={C} y={C + R + 34} textAnchor="middle">Z</text>
      <text className="joint-wheel__label" x={C - R - 18} y={C + 5} textAnchor="end">YL</text>
      <text className="joint-wheel__label" x={C + R + 18} y={C + 5}>YR</text>
    </>
  )

  if (joint.type === 'slide') {
    const y = C + R - 2 * R * slideFraction(joint, value)
    return (
      <div ref={rootRef} className={rootClass}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <line className="joint-wheel__axis" x1={C - R - 10} y1={C} x2={C + R + 10} y2={C} />
          <line className="joint-wheel__track" x1={C} y1={C - R} x2={C} y2={C + R} />
          <line className="joint-wheel__limit" x1={C - 8} y1={C - R} x2={C + 8} y2={C - R} />
          <line className="joint-wheel__limit" x1={C - 8} y1={C + R} x2={C + 8} y2={C + R} />
          {labels}
          <line className="joint-wheel__hit" x1={C} y1={C - R} x2={C} y2={C + R} {...handlers} />
          <circle className="joint-wheel__handle" cx={C} cy={y} r={8} {...handlers} />
        </svg>
      </div>
    )
  }

  // Hinge: the handle points along the part; the solid arc is where its limits let it turn, dashed is out of reach.
  const angle = aimAngle(aim, value)
  let a0 = 0
  let a1 = TAU
  const limited = joint.range !== null && joint.range[1] - joint.range[0] < TAU - 1e-3
  if (limited) {
    const ends = joint.range!.map((limit) => angle + aim.sense * (limit - value)).sort((a, b) => a - b)
    a0 = ends[0]!
    a1 = ends[1]!
  }
  const [hx, hy] = polar(C, C, R, angle)
  const tick = (a: number) => {
    const [x0, y0] = polar(C, C, R - 7, a)
    const [x1, y1] = polar(C, C, R + 7, a)
    return <line key={a} className="joint-wheel__limit" x1={x0} y1={y0} x2={x1} y2={y1} />
  }

  return (
    <div ref={rootRef} className={rootClass}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <line className="joint-wheel__axis" x1={C} y1={C - R - 12} x2={C} y2={C + R + 12} />
        <line className="joint-wheel__axis" x1={C - R - 12} y1={C} x2={C + R + 12} y2={C} />
        {limited ? (
          <>
            <path className="joint-wheel__track" d={arcPath(C, C, R, a0, a1)} />
            <path className="joint-wheel__track joint-wheel__track--out" d={arcPath(C, C, R, a1, a0 + TAU)} />
            {tick(a0)}
            {tick(a1)}
          </>
        ) : (
          <circle className="joint-wheel__track" cx={C} cy={C} r={R} />
        )}
        {labels}
        <line className="joint-wheel__spoke" x1={C} y1={C} x2={hx} y2={hy} />
        <circle className="joint-wheel__hub" cx={C} cy={C} r={10} />
        <circle className="joint-wheel__pivot" cx={C} cy={C} r={4} />
        <circle className="joint-wheel__hit" cx={C} cy={C} r={R} {...handlers} />
        <circle className="joint-wheel__handle" cx={hx} cy={hy} r={8} {...handlers} />
      </svg>
    </div>
  )
}
