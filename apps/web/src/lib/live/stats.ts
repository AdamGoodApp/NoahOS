/** Link-quality estimators for the live HUD (STACK.md §4.1, §7.7). Pure: time is always passed in. */

export type SignalQuality = 'good' | 'degraded' | 'lost'

export type LiveStatsSnapshot = {
  /** Telemetry messages per second over the last second. */
  hz: number
  /** Standard deviation of inter-arrival intervals over the last 60 messages, ms. */
  jitterMs: number
  /** Missing sequence numbers since the session started. */
  drops: number
  /** Missing sequence numbers in the last second. */
  recentDrops: number
  rttMs: number | null
  /** Sim wall clock minus browser clock, ms (EWMA). */
  offsetMs: number | null
  /** Age of the newest telemetry frame when it arrived, corrected by the clock offset, ms. */
  ageMs: number | null
  quality: SignalQuality
}

const WINDOW_MS = 1000
const JITTER_SAMPLES = 60
const LOST_MS = 1500
const ALPHA = 0.3

export class LiveStats {
  private arrivals: number[] = []
  private intervals: number[] = []
  private gaps: { at: number; n: number }[] = []
  private lastSeq: bigint | null = null
  private lastArrival: number | null = null
  private drops = 0
  private rtt: number | null = null
  private offset: number | null = null
  private age: number | null = null

  constructor(private expectedHz: number = 60) {}

  setExpectedHz(hz: number) {
    this.expectedHz = hz
  }

  /** `sentUnixNs` is the sim's send time; `now` is Date.now() at arrival. */
  telemetry(seq: bigint, sentUnixNs: bigint, now: number) {
    if (this.lastSeq !== null && seq > this.lastSeq + 1n) {
      const n = Number(seq - this.lastSeq - 1n)
      this.drops += n
      this.gaps.push({ at: now, n })
    }
    if (this.lastSeq === null || seq > this.lastSeq) this.lastSeq = seq
    if (this.lastArrival !== null) {
      this.intervals.push(now - this.lastArrival)
      if (this.intervals.length > JITTER_SAMPLES) this.intervals.shift()
    }
    this.lastArrival = now
    this.arrivals.push(now)
    if (this.offset !== null) this.age = Math.max(0, now - (Number(sentUnixNs / 1000n) / 1000 - this.offset))
    this.trim(now)
  }

  /** Ping/pong round trip: `clientMs` echoed from our Ping, `serverUnixNs` the sim's clock when it answered. */
  pong(clientMs: number, serverUnixNs: bigint, now: number) {
    const rtt = Math.max(0, now - clientMs)
    this.rtt = this.rtt === null ? rtt : this.rtt + ALPHA * (rtt - this.rtt)
    const offset = Number(serverUnixNs / 1000n) / 1000 - (clientMs + rtt / 2)
    this.offset = this.offset === null ? offset : this.offset + ALPHA * (offset - this.offset)
  }

  reset() {
    this.arrivals = []
    this.intervals = []
    this.gaps = []
    this.lastSeq = null
    this.lastArrival = null
    this.drops = 0
    this.rtt = null
    this.offset = null
    this.age = null
  }

  snapshot(now: number): LiveStatsSnapshot {
    this.trim(now)
    const hz = this.arrivals.length
    const mean = this.intervals.reduce((a, b) => a + b, 0) / (this.intervals.length || 1)
    const variance = this.intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / (this.intervals.length || 1)
    const jitterMs = Math.sqrt(variance)
    const recentDrops = this.gaps.reduce((a, g) => a + g.n, 0)
    const lost = this.lastArrival === null || now - this.lastArrival > LOST_MS
    const good = hz >= 0.9 * this.expectedHz && jitterMs < 8 && recentDrops === 0
    return {
      hz,
      jitterMs,
      drops: this.drops,
      recentDrops,
      rttMs: this.rtt,
      offsetMs: this.offset,
      // Age of the newest frame *now*: its age on arrival plus the time since, so it grows during an outage.
      ageMs: this.age === null || this.lastArrival === null ? null : this.age + (now - this.lastArrival),
      quality: lost ? 'lost' : good ? 'good' : 'degraded',
    }
  }

  private trim(now: number) {
    const cut = now - WINDOW_MS
    while (this.arrivals.length && this.arrivals[0]! < cut) this.arrivals.shift()
    while (this.gaps.length && this.gaps[0]!.at < cut) this.gaps.shift()
  }
}
