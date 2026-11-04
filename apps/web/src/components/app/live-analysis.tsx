import { Tile } from '@carbon/react'
import { useEffect, useState } from 'react'

import type { JointSpec, Telemetry, Welcome } from '@/gen/noahos/sim/v1/sim_pb'
import type { LiveAnalyticsSnapshot } from '@/lib/live/analytics'
import { humanize } from './control-state'
import { clamp } from './joint-control'

/** Modelled motor temperature at which a joint is flagged for service (°C). The thermal model clamps at 120 °C. */
const SERVICE_TEMP_C = 80
/** A task cycle counts as delayed when its wall time is this much over the nominal period. */
const DELAY_FACTOR = 1.1
const OUTPUT_POLL_MS = 15_000

type Bar = { key: string; value: number; label: string; alert?: boolean }

/** Vertical position (0 = top, 100 = bottom) of `v` on a 0..max scale, clamped. */
const yOf = (v: number, max: number) => 100 - clamp(v / max, 0, 1) * 100

/** Bars on a 0..max scale with an optional dashed reference line; colours come from Carbon tokens in app.scss. */
function BarChart({ bars, max, line, lineLabel, ariaLabel, slots = 0 }: { bars: Bar[]; max: number; line?: number; lineLabel?: string; ariaLabel: string; slots?: number }) {
  // `slots` keeps bar widths steady while a history fills up (newest on the right).
  const n = Math.max(bars.length, slots, 1)
  const offset = n - bars.length
  const w = 100 / n
  const y = (v: number) => yOf(v, max)
  return (
    <svg className="live-chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
      {bars.map((b, i) => (
        <rect
          key={b.key}
          className={b.alert ? 'live-chart__bar live-chart__bar--alert' : 'live-chart__bar'}
          x={(offset + i) * w + w * 0.2}
          width={w * 0.6}
          y={y(b.value)}
          height={100 - y(b.value)}
        >
          <title>{b.label}</title>
        </rect>
      ))}
      {line !== undefined && (
        <line className="live-chart__line" x1={0} x2={100} y1={y(line)} y2={y(line)} vectorEffect="non-scaling-stroke">
          {lineLabel && <title>{lineLabel}</title>}
        </line>
      )}
    </svg>
  )
}

/** Fixed-height card: every text line is single-line (ellipsis, full text on hover), so changing values never reflow the dock. */
function Card({ title, subtitle, value, note, children }: { title: string; subtitle: string; value: string; note?: string; children: React.ReactNode }) {
  return (
    <Tile className="live-card">
      <div className="live-card__head">
        <div className="live-card__titles">
          <h3 className="live-card__title" title={`${title}: ${subtitle}`}>
            {title}
          </h3>
          <p className="live-card__subtitle" title={subtitle}>
            {subtitle}
          </p>
        </div>
        <p className="live-card__value">{value}</p>
      </div>
      {children}
      <p className="live-card__note" title={note}>
        {note ?? '\u00a0'}
      </p>
    </Tile>
  )
}

/**
 * Line of the newest `slots` samples on a 0..max scale with a dashed threshold line, its label, and a dot on the latest
 * value. Text and the dot are HTML over the stretched SVG, so they keep their shape at any card width.
 */
function LineChart({ values, max, slots, threshold, thresholdLabel, ariaLabel }: { values: number[]; max: number; slots: number; threshold: number; thresholdLabel: string; ariaLabel: string }) {
  const pct = (v: number) => yOf(v, max)
  const step = 100 / Math.max(slots - 1, 1)
  const start = slots - values.length
  const points = values.map((v, i) => `${(start + i) * step},${pct(v)}`).join(' ')
  const last = values.at(-1)
  return (
    <div className="live-line" role="img" aria-label={ariaLabel}>
      <svg className="live-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line className="live-chart__line live-chart__line--alert" x1={0} x2={100} y1={pct(threshold)} y2={pct(threshold)} vectorEffect="non-scaling-stroke" />
        {values.length > 1 && <polyline className="live-chart__trace" points={points} vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="live-line__label" style={{ bottom: `${100 - pct(threshold)}%` }}>
        {thresholdLabel}
      </span>
      {last !== undefined && (
        <span
          className={last >= threshold ? 'live-line__dot live-line__dot--alert' : 'live-line__dot'}
          style={{ left: '100%', top: `${pct(last)}%` }}
        />
      )}
    </div>
  )
}

const actuated = (joints: JointSpec[]) => joints.map((j, i) => ({ j, i })).filter(({ j }) => j.actuated)

/** Torque load, joint health, cycle time and daily output under the live 3D view (Control page, live only). */
export function LiveAnalysis({ robotId, welcome, telemetry, analytics }: { robotId: string; welcome: Welcome; telemetry: Telemetry | null; analytics: LiveAnalyticsSnapshot }) {
  const joints = welcome.robot?.joints ?? []
  const period = welcome.policies.find((p) => p.id === telemetry?.policy)?.periodS ?? 0
  const output = useDailyOutput(robotId)

  // Torque load: |torque| now as a share of each actuator's limit; peak this session in the tooltip.
  const limited = actuated(joints).filter(({ j }) => j.effortLimit > 0)
  const torqueBars: Bar[] = limited.map(({ j, i }) => {
    const pct = (Math.abs(telemetry?.torque[i] ?? 0) / j.effortLimit) * 100
    const peak = ((analytics.peakTorque[i] ?? 0) / j.effortLimit) * 100
    return { key: j.name, value: pct, alert: pct >= 90, label: `${humanize(j.name)}: ${pct.toFixed(0)}% now, peak ${peak.toFixed(0)}% of ${j.effortLimit.toFixed(0)}` }
  })
  const top = torqueBars.reduce<Bar | null>((a, b) => (!a || b.value > a.value ? b : a), null)

  // Joint health: the hottest modelled motor over the last two minutes against the service line.
  const temps = actuated(joints).map(({ j, i }) => ({ name: j.name, c: telemetry?.motorTempC[i] ?? 0 }))
  const service = temps.filter((t) => t.c >= SERVICE_TEMP_C).length
  const hottest = temps.reduce<{ name: string; c: number } | null>((a, b) => (!a || b.c > a.c ? b : a), null)

  // Cycle time: wall time of each completed task cycle against the nominal period.
  const cycleBars: Bar[] = analytics.cycles.map((c) => ({
    key: String(c.cycle),
    value: c.seconds,
    alert: period > 0 && c.seconds > period * DELAY_FACTOR,
    label: `Cycle ${c.cycle}: ${c.seconds.toFixed(2)} s`,
  }))
  const lastCycle = analytics.cycles.at(-1)
  const delays = cycleBars.filter((b) => b.alert).length

  const today = output?.at(-1)?.cycles ?? 0
  const outputBars: Bar[] = (output ?? []).map((d) => ({ key: d.day, value: d.cycles, label: `${d.day}: ${d.cycles} cycles` }))

  return (
    <div id="live-analysis" className="live-analysis">
      <Card
        title="Torque load analysis"
        subtitle="Share of each motor's torque limit, now"
        value={top ? `${top.value.toFixed(0)}%` : '—'}
        note={limited.length ? (top ? `Highest: ${top.label.split(':')[0]}` : undefined) : 'This model gives no torque limits'}
      >
        <BarChart bars={torqueBars} max={100} line={100} lineLabel="Torque limit" ariaLabel="Torque per joint as a share of its limit" />
      </Card>
      <Card
        title="Joint health"
        subtitle="Hottest motor, last 2 min (modelled)"
        value={hottest ? `${hottest.c.toFixed(0)} °C` : '—'}
        note={
          service
            ? `${service} ${service === 1 ? 'joint needs' : 'joints need'} service`
            : hottest
              ? `Hottest: ${humanize(hottest.name)}`
              : undefined
        }
      >
        <LineChart
          values={analytics.hottestTemp}
          max={120}
          slots={120}
          threshold={SERVICE_TEMP_C}
          thresholdLabel={`Needs service · ${SERVICE_TEMP_C} °C`}
          ariaLabel="Hottest modelled motor temperature over the last two minutes"
        />
      </Card>
      <Card
        title="Cycle time"
        subtitle={`Per task cycle · nominal ${period.toFixed(0)} s`}
        value={lastCycle ? `${lastCycle.seconds.toFixed(1)} s` : '—'}
        note={cycleBars.length ? (delays ? `${delays} delayed (over ${Math.round((DELAY_FACTOR - 1) * 100)}%)` : 'No delays') : 'Measured from the next full cycle'}
      >
        <BarChart bars={cycleBars} max={Math.max(period * 1.5, ...cycleBars.map((b) => b.value), 1)} line={period} lineLabel="Nominal period" ariaLabel="Wall time of recent task cycles" slots={12} />
      </Card>
      <Card title="Daily output" subtitle="Task cycles completed, last 7 days (UTC)" value={output ? String(today) : '—'} note={output ? 'Today so far' : undefined}>
        <BarChart bars={outputBars} max={Math.max(1, ...outputBars.map((b) => b.value))} ariaLabel="Task cycles completed per day" slots={7} />
      </Card>
    </div>
  )
}

function useDailyOutput(robotId: string) {
  const [days, setDays] = useState<{ day: string; cycles: number }[] | null>(null)
  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const r = await fetch(`/api/live/robots/${encodeURIComponent(robotId)}/output`)
        const body: unknown = r.ok ? await r.json() : null
        if (alive && body && typeof body === 'object' && 'days' in body && Array.isArray(body.days)) setDays(body.days.filter(isDay))
      } catch {
        /* keep the last value; the card shows "—" until the first answer */
      }
    }
    void load()
    const id = window.setInterval(() => void load(), OUTPUT_POLL_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [robotId])
  return days
}

function isDay(v: unknown): v is { day: string; cycles: number } {
  return !!v && typeof v === 'object' && 'day' in v && typeof v.day === 'string' && 'cycles' in v && typeof v.cycles === 'number'
}
