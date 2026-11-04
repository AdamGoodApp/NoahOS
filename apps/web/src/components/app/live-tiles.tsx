import { ProgressBar, Tile } from '@carbon/react'

import { EventKind, Mode } from '@/gen/noahos/sim/v1/sim_pb'
import type { LiveState } from '@/lib/live/client'
import type { SignalQuality } from '@/lib/live/stats'

export function StatTile({ caption, value, bar }: { caption: string; value: string; bar: number }) {
  return (
    <Tile className="control-stat">
      <p className="control-stat__value" title={value}>
        {value}
      </p>
      <p className="control-stat__caption" title={caption}>
        {caption}
      </p>
      <ProgressBar hideLabel label={caption} value={Math.max(0, Math.min(100, bar))} max={100} size="small" />
    </Tile>
  )
}

export const MODE_LABEL: Record<Mode, string> = {
  [Mode.UNSPECIFIED]: 'Connecting',
  [Mode.AUTO]: 'Playing',
  [Mode.MANUAL]: 'Manual',
  [Mode.STOPPED]: 'Stopped',
}

export const SIGNAL_LABEL: Record<SignalQuality, string> = { good: 'Good', degraded: 'Degraded', lost: 'Lost' }

export const EVENT_LABEL: Record<EventKind, string> = {
  [EventKind.UNSPECIFIED]: 'Info',
  [EventKind.INFO]: 'Info',
  [EventKind.MODE]: 'Mode',
  [EventKind.ROLE]: 'Control',
  [EventKind.DENIED]: 'Denied',
  [EventKind.ERROR]: 'Error',
  [EventKind.RECORDING]: 'Recording',
}

export const clockTime = (at: number) => new Date(at).toLocaleTimeString([], { hour12: false })

export function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

export const ms = (v: number | null, digits = 0) => (v === null ? '—' : `${v.toFixed(digits)} ms`)

/** Power, Signal, Speed and Latency from the live link: Simulation tab and the Control page's live dock. */
export function LiveStatTiles({ live, className }: { live: LiveState; className: string }) {
  const t = live.telemetry
  const s = live.stats
  const maxSpeed = t ? Math.max(0, ...t.qvel.map(Math.abs)) : 0
  return (
    <div className={className}>
      <StatTile caption="Power" value={t ? `${t.totalPowerW.toFixed(1)} W` : '—'} bar={t ? t.totalPowerW : 0} />
      <StatTile
        caption={`Signal & latency (RTT) · ${s.hz} Hz · jitter ${s.jitterMs.toFixed(1)} ms · age ${ms(s.ageMs)}`}
        value={`${SIGNAL_LABEL[s.quality]} · ${ms(s.rttMs)}`}
        bar={s.quality === 'good' ? 100 : s.quality === 'degraded' ? 50 : 0}
      />
      <StatTile caption="Speed (max rad/s)" value={maxSpeed.toFixed(2)} bar={(maxSpeed / 4) * 100} />
      <StatTile
        caption="Sim CPU (100% = one core)"
        value={t?.stats ? `${Math.round(t.stats.cpuPercent)}%` : '—'}
        bar={t?.stats?.cpuPercent ?? 0}
      />
    </div>
  )
}
