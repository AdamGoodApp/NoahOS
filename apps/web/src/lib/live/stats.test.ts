import { describe, expect, it } from 'vitest'

import { LiveStats } from './stats'

const NS = 1_000_000n

/** Feeds `count` frames at `periodMs`, starting at `start`, with seq from `seq0`; sim clock = browser clock + skewMs. */
function feed(stats: LiveStats, { start, count, periodMs, seq0 = 1, skewMs = 0, skip = new Set<number>() }: {
  start: number
  count: number
  periodMs: number
  seq0?: number
  skewMs?: number
  skip?: Set<number>
}) {
  let now = start
  for (let i = 0; i < count; i++) {
    now = start + i * periodMs
    const seq = seq0 + i
    if (skip.has(seq)) continue
    stats.telemetry(BigInt(seq), BigInt(Math.round(now - 5 + skewMs)) * NS, now)
  }
  return now
}

describe('LiveStats', () => {
  it('reports a steady 60 Hz stream as good', () => {
    const s = new LiveStats(60)
    const end = feed(s, { start: 10_000, count: 120, periodMs: 1000 / 60 })
    const snap = s.snapshot(end)
    expect(snap.hz).toBeGreaterThanOrEqual(59)
    expect(snap.jitterMs).toBeLessThan(0.5)
    expect(snap.drops).toBe(0)
    expect(snap.quality).toBe('good')
  })

  it('counts sequence gaps as drops and degrades while they are recent', () => {
    const s = new LiveStats(60)
    const end = feed(s, { start: 0, count: 120, periodMs: 1000 / 60, skip: new Set([100, 101, 102]) })
    const snap = s.snapshot(end)
    expect(snap.drops).toBe(3)
    expect(snap.recentDrops).toBe(3)
    expect(snap.quality).toBe('degraded')
    // A second later the gap has left the window; the total stays.
    const later = feed(s, { start: end + 1000 / 60, count: 70, periodMs: 1000 / 60, seq0: 121 })
    expect(s.snapshot(later).recentDrops).toBe(0)
    expect(s.snapshot(later).drops).toBe(3)
  })

  it('degrades on jitter and on a low rate', () => {
    const jittery = new LiveStats(60)
    let now = 0
    for (let i = 1; i <= 120; i++) {
      now += i % 2 ? 4 : 30
      jittery.telemetry(BigInt(i), BigInt(now) * NS, now)
    }
    expect(jittery.snapshot(now).jitterMs).toBeGreaterThan(8)
    expect(jittery.snapshot(now).quality).toBe('degraded')

    const slow = new LiveStats(60)
    const end = feed(slow, { start: 0, count: 60, periodMs: 1000 / 30 })
    expect(slow.snapshot(end).quality).toBe('degraded')
  })

  it('is lost after 1.5 s without telemetry', () => {
    const s = new LiveStats(60)
    const end = feed(s, { start: 0, count: 60, periodMs: 1000 / 60 })
    expect(s.snapshot(end + 1499).quality).not.toBe('lost')
    expect(s.snapshot(end + 1501).quality).toBe('lost')
  })

  it('derives RTT, clock offset and telemetry age from ping/pong', () => {
    const s = new LiveStats(60)
    const skew = 250 // sim clock runs 250 ms ahead of the browser
    // Ping sent at 1000, sim answers at browser-time 1010 (+skew), pong arrives at 1020.
    s.pong(1000, BigInt(1010 + skew) * NS, 1020)
    const snap = s.snapshot(1020)
    expect(snap.rttMs).toBe(20)
    expect(snap.offsetMs).toBeCloseTo(skew, 6)
    // Frame sent at browser-time 1015 (+skew) arrives at 1040: 25 ms old.
    s.telemetry(1n, BigInt(1015 + skew) * NS, 1040)
    expect(s.snapshot(1040).ageMs).toBeCloseTo(25, 6)
  })

  it('smooths RTT with an EWMA', () => {
    const s = new LiveStats(60)
    s.pong(0, 5n * NS, 10)
    s.pong(100, 115n * NS, 130)
    expect(s.snapshot(130).rttMs).toBeCloseTo(10 + 0.3 * (30 - 10), 6)
  })
})
