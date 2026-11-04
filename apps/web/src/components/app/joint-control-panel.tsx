import { Dropdown, Tag, Toggle } from '@carbon/react'
import { CenterCircle, Rotate, Scales } from '@carbon/icons-react'
import type { ComponentType } from 'react'

import type { JointStats } from '@/lib/mjcf/build'
import { humanize, type JointInfo } from './control-state'
import { isAtLimit, RAD_TO_DEG, type AimStore } from './joint-control'
import { JointPad, type PadFollow } from './joint-pad'

type Props = {
  /** Display name of the selected part, or null when nothing is selected. */
  selected: string | null
  /** Hinge and slide joints of the selected part. */
  joints: JointInfo[]
  joint: JointInfo | null
  value: number
  stats: JointStats | null
  aimStore: AimStore
  onPickJoint(name: string): void
  onChange(joint: string, value: number, phase: 'move' | 'end'): void
  /** "All joints follow": the pad drags the part and the joints below it follow (inverse kinematics). */
  followAll: boolean
  onFollowAllChange(on: boolean): void
  follow: PadFollow
  /** Live view without control (task running, stopped, or viewer): show the joint and its load only, no pad. */
  readOnly: boolean
}

function format(joint: JointInfo, v: number) {
  return joint.type === 'hinge' ? `${Math.round(v * RAD_TO_DEG)}°` : `${Math.round(v * 1000)} mm`
}

/** Right-hand panel while the Control joint tool is active: the selected joint, its static load and the XY pad. */
export function JointControlPanel({
  selected,
  joints,
  joint,
  value,
  stats,
  aimStore,
  onPickJoint,
  onChange,
  followAll,
  onFollowAllChange,
  follow,
  readOnly,
}: Props) {
  if (!joint) {
    return (
      <div className="joint-panel joint-panel--empty">
        <h2 className="joint-panel__eyebrow">{readOnly ? 'Joint' : 'Joint control'}</h2>
        <p className="joint-panel__empty-text">
          {readOnly
            ? selected
              ? `${selected} has no joint. Select another part.`
              : 'Select a part in the 3D view to see its joint.'
            : selected
              ? `${selected} has no joint you can move. Select another part.`
              : 'Select a part in the 3D view to control its joint.'}
        </p>
      </div>
    )
  }

  const atLimit = isAtLimit(joint, value)
  const range = joint.range ? `${format(joint, joint.range[0])} … ${format(joint, joint.range[1])}` : 'Unlimited'
  const valueText = format(joint, value)
  const loadUnit = joint.type === 'hinge' ? 'N·m' : 'N'

  return (
    <div className="joint-panel">
      <div className="joint-panel__head">
        <div>
          <h2 className="joint-panel__title">{humanize(joint.name)}</h2>
          <p className="joint-panel__subtitle">
            {humanize(joint.body)} · {joint.type}
          </p>
        </div>
        {atLimit && (
          <Tag type="red" size="sm">
            At limit
          </Tag>
        )}
      </div>

      {joints.length > 1 && (
        <Dropdown
          id="joint-control-pick"
          size="sm"
          titleText="Joint"
          label="Joint"
          items={joints}
          itemToString={(j) => (j ? humanize(j.name) : '')}
          selectedItem={joint}
          onChange={({ selectedItem }) => selectedItem && onPickJoint(selectedItem.name)}
        />
      )}

      <p className="joint-panel__value">
        {valueText}
        <span className="joint-panel__range">{range}</span>
      </p>

      <div className="joint-panel__stats">
        <Stat icon={CenterCircle} caption="CoG (mm)" fraction={null} value={stats ? cogText(stats.cog) : '—'} />
        <Stat
          icon={Scales}
          caption="Mass moved"
          fraction={stats?.massFraction ?? null}
          value={stats ? `${stats.mass.toFixed(stats.mass < 10 ? 2 : 1)} kg` : '—'}
        />
        <Stat
          icon={Rotate}
          caption={joint.type === 'hinge' ? 'Gravity torque' : 'Gravity force'}
          fraction={stats?.loadFraction ?? null}
          value={stats ? `${stats.load.toFixed(1)} ${loadUnit}` : '—'}
        />
      </div>
      {!stats && <p className="joint-panel__note">The model gives no mass for this part, so its load can't be worked out.</p>}

      {readOnly ? (
        <p className="joint-panel__note">
          Locked: values come from the simulation. Only the operator can move joints, in Manual hold. Load is static: gravity at this pose, without motion.
        </p>
      ) : (
        <>
          <div className="joint-panel__pad-head">
            <span className="joint-panel__pad-title">XY pad</span>
            <Toggle
              id="joint-pad-follow"
              size="sm"
              labelText="All joints follow"
              hideLabel
              toggled={followAll}
              onToggle={onFollowAllChange}
            />
          </div>
          <JointPad
            joint={joint}
            value={value}
            aimStore={aimStore}
            valueText={valueText}
            onChange={(v, phase) => onChange(joint.name, v, phase)}
            follow={followAll ? follow : null}
          />
          <p className="joint-panel__note">
            {followAll
              ? 'All joints follow: drag on the pad to move the part across the screen; the joints below it turn to reach. Arrow keys nudge it.'
              : joint.type === 'hinge'
                ? 'Only this joint turns: drag on the pad or the wheel to aim the part. Arrow keys turn 1°, Shift+arrow 10°.'
                : 'Only this joint moves: drag up or down to slide the part. Arrow keys move 1 mm, Shift+arrow 10 mm.'}
            {' '}Load is static: gravity at this pose, without motion.
          </p>
        </>
      )}
    </div>
  )
}

function cogText([x, y, z]: [number, number, number]) {
  const mm = (v: number) => Math.round(v * 1000)
  return `X:${mm(x)} Y:${mm(y)} Z:${mm(z)}`
}

function Stat({
  icon: Icon,
  caption,
  value,
  fraction,
}: {
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean }>
  caption: string
  value: string
  /** Share shown by the ring (0–1); null draws the track only. */
  fraction: number | null
}) {
  const r = 15
  const length = 2 * Math.PI * r
  return (
    <div className="joint-stat">
      <span className="joint-stat__ring">
        <svg className="joint-stat__gauge" viewBox="0 0 36 36" aria-hidden="true">
          <circle className="joint-stat__track" cx={18} cy={18} r={r} />
          {fraction !== null && (
            <circle
              className="joint-stat__fill"
              cx={18}
              cy={18}
              r={r}
              strokeDasharray={`${length * fraction} ${length}`}
              transform="rotate(-90 18 18)"
            />
          )}
        </svg>
        <Icon size={16} aria-hidden />
      </span>
      <span className="joint-stat__text">
        <span className="joint-stat__caption">{caption}</span>
        <span className="joint-stat__value">{value}</span>
      </span>
    </div>
  )
}
