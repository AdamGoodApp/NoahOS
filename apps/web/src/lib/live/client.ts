/** Browser side of the live link: one binary WebSocket to the relay, Protobuf both ways (STACK.md §4, §7.2). */
import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf'

import {
  ClientMessageSchema,
  EventKind,
  Mode,
  Role,
  ServerMessageSchema,
  type SessionInfo,
  type Telemetry,
  type Welcome,
} from '@/gen/noahos/sim/v1/sim_pb'
import { LiveAnalytics, type LiveAnalyticsSnapshot } from './analytics'
import { LiveStats, type LiveStatsSnapshot } from './stats'

export type LiveStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error'
export type LiveEvent = { id: number; at: number; kind: EventKind; message: string }

export type LiveState = {
  status: LiveStatus
  error: string | null
  /** Stop was pressed while not connected: the E-stop is sent as soon as the socket opens, then live view ends. */
  stopping: boolean
  welcome: Welcome | null
  session: SessionInfo | null
  /** Newest telemetry at the last slow publish (5 Hz); per-frame consumers use subscribeFrame/getFrame. */
  telemetry: Telemetry | null
  mode: Mode
  /** Id of the sim's selected policy (Welcome.policies); it plays only in Mode.AUTO. */
  policy: string
  stats: LiveStatsSnapshot
  /** Torque peaks and task cycle times for this sim session, refreshed with `stats`. */
  analytics: LiveAnalyticsSnapshot
  events: LiveEvent[]
  /** Date.now() when the current connection went live. */
  liveSince: number | null
}

const BACKOFF_MS = [500, 1000, 2000, 4000, 4000]
const PING_MS = 1000
const SLOW_PUBLISH_MS = 200
const MAX_EVENTS = 200

export const IDLE_STATE: LiveState = {
  status: 'idle',
  error: null,
  stopping: false,
  welcome: null,
  session: null,
  telemetry: null,
  mode: Mode.UNSPECIFIED,
  policy: '',
  stats: new LiveStats().snapshot(0),
  analytics: { peakTorque: [], cycles: [], hottestTemp: [] },
  events: [],
  liveSince: null,
}

/**
 * A random v4 UUID. `crypto.randomUUID` exists only in secure contexts (https, localhost); a page served over the LAN
 * (`http://<mac-ip>:3100`, e.g. Safari on Vision Pro next to the app) lacks it, while `getRandomValues` works everywhere.
 */
function randomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6]! & 0x0f) | 0x40
  b[8] = (b[8]! & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function clientId(): string {
  const key = 'noahos.clientId'
  try {
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const id = randomId()
    sessionStorage.setItem(key, id)
    return id
  } catch {
    return randomId()
  }
}

export class LiveClient {
  readonly clientId = clientId()
  private ws: WebSocket | null = null
  private state: LiveState = IDLE_STATE
  private listeners = new Set<() => void>()
  private frameListeners = new Set<() => void>()
  private frame: Telemetry | null = null
  private frameScheduled = false
  private stats = new LiveStats()
  private analytics = new LiveAnalytics(Mode.AUTO)
  private attempt = 0
  private wantOpen = false
  private timers: number[] = []
  private retryTimer: number | undefined
  private eventId = 0
  /** Set on connect; cleared once the operator's first look at the mode has been handled (maybeReleaseStop). */
  private releaseStop = false
  private pendingTargets = new Map<number, number>()
  private flushScheduled = false
  private jointIndex = new Map<string, number>()

  constructor(
    readonly robotId: string,
    /** Pairing token shared with the visionOS app (`?pair=`): the relay grants both devices the operator lock. */
    readonly pairToken = '',
  ) {}

  // ---- store API (useSyncExternalStore) -----------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get = () => this.state

  /** Per-telemetry subscription, coalesced to one call per animation frame. */
  subscribeFrame = (listener: () => void) => {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  getFrame = () => this.frame

  // ---- commands -----------------------------------------------------------------------------

  connect() {
    if (this.wantOpen) return
    this.wantOpen = true
    this.attempt = 0
    this.releaseStop = true
    this.open('connecting')
  }

  close() {
    if (!this.wantOpen && !this.ws && this.state.status !== 'error') return
    this.wantOpen = false
    clearTimeout(this.retryTimer)
    this.stopTimers()
    this.ws?.close(1000, 'operator ended live view')
    this.ws = null
    this.frame = null
    this.set({ ...IDLE_STATE, events: this.state.events })
    this.addEvent(EventKind.INFO, 'Live view ended')
  }

  /**
   * Joint name → target (rad or m), coalesced into one JointTargets per animation frame.
   * The relay and the sim accept these only from the operator in Manual hold.
   */
  sendTargets(changed: Record<string, number>) {
    for (const [name, value] of Object.entries(changed)) {
      const index = this.jointIndex.get(name)
      if (index !== undefined && Number.isFinite(value)) this.pendingTargets.set(index, value)
    }
    if (!this.pendingTargets.size || this.flushScheduled) return
    this.flushScheduled = true
    requestAnimationFrame(() => {
      this.flushScheduled = false
      if (!this.pendingTargets.size) return
      const jointIndex = [...this.pendingTargets.keys()]
      const target = [...this.pendingTargets.values()]
      this.pendingTargets.clear()
      this.send({ case: 'jointTargets', value: { jointIndex, target } })
    })
  }

  /** Play a policy from Welcome.policies (operator only; the sim switches from whatever is playing). */
  play(policy: string) {
    this.send({ case: 'setMode', value: { mode: Mode.AUTO, policy } })
  }

  /** Manual hold: pause the playing policy and hold the current pose (operator only). */
  hold() {
    this.send({ case: 'setMode', value: { mode: Mode.MANUAL } })
  }

  estop() {
    this.send({ case: 'estop', value: {} })
  }

  /** The header's Stop: halt the robot (E-stop, any role) and leave live view in one action. */
  stop() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.estop() // queued before the close frame, so the relay receives it first
      this.close()
      return
    }
    // Not connected (connecting or reconnecting): the robot cannot be reached yet. Keep (re)connecting and deliver the
    // E-stop the moment the socket opens; only then leave live view. Cancel stays possible via close().
    if (!this.wantOpen) return
    this.set({ ...this.state, stopping: true })
  }

  /**
   * Going live never starts anything, and a robot left stopped by an earlier Stop should not need a Resume: once per
   * connection, if this client is the operator and the sim is stopped, put it in Manual hold (holds the current pose).
   */
  private maybeReleaseStop(mode: Mode) {
    // Judged on telemetry only: a Welcome (possibly the relay's cached copy) can carry a stale mode.
    if (!this.releaseStop || this.state.session?.grantedRole !== Role.OPERATOR) return
    this.releaseStop = false
    if (mode === Mode.STOPPED) this.hold()
  }

  record(start: boolean, label = '') {
    this.send({ case: 'recording', value: { start, taskLabel: label } })
  }

  takeControl() {
    this.hello()
  }

  // ---- connection ---------------------------------------------------------------------------

  private open(status: 'connecting' | 'reconnecting') {
    this.set({ ...this.state, status, error: null })
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/ws/robots/${encodeURIComponent(this.robotId)}?client=${this.clientId}`
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e))
      return
    }
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      this.stats.reset()
      this.hello()
      if (this.state.stopping) {
        this.estop()
        this.addEvent(EventKind.INFO, 'Stop delivered after reconnecting')
        this.close()
        return
      }
      this.ping()
      this.timers.push(window.setInterval(() => this.ping(), PING_MS))
      this.timers.push(window.setInterval(() => this.publishSlow(), SLOW_PUBLISH_MS))
    }
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) this.receive(new Uint8Array(e.data))
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return
      this.ws = null
      this.stopTimers()
      if (!this.wantOpen) return
      if (e.code === 1008) {
        this.fail(e.reason || 'The relay closed the connection (policy)')
        return
      }
      this.retry(e.reason || (this.state.status === 'live' ? 'Connection lost' : 'Could not reach the simulation'))
    }
  }

  private retry(reason: string) {
    if (this.attempt >= BACKOFF_MS.length) {
      this.fail(`${reason}. Gave up after ${BACKOFF_MS.length} attempts.`)
      return
    }
    const delay = BACKOFF_MS[this.attempt++]!
    this.addEvent(EventKind.INFO, `${reason}; reconnecting in ${delay / 1000} s`)
    this.set({ ...this.state, status: 'reconnecting', liveSince: null })
    this.retryTimer = window.setTimeout(() => this.open('reconnecting'), delay)
  }

  private fail(message: string) {
    this.wantOpen = false
    this.stopTimers()
    const stopping = this.state.stopping
    const text = stopping ? `${message} The Stop could not be delivered: the robot may still be moving.` : message
    this.addEvent(EventKind.ERROR, text)
    this.set({ ...this.state, status: 'error', error: text, liveSince: null, stopping: false })
  }

  private stopTimers() {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
  }

  private hello() {
    this.send({ case: 'hello', value: { clientId: this.clientId, role: Role.OPERATOR, telemetryDivisor: 1, pairToken: this.pairToken } })
  }

  private ping() {
    this.send({ case: 'ping', value: { clientId: this.clientId, clientMs: BigInt(Date.now()) } })
  }

  private send(msg: MessageInitShape<typeof ClientMessageSchema>['msg']): boolean {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(toBinary(ClientMessageSchema, create(ClientMessageSchema, { msg })))
    return true
  }

  private receive(bytes: Uint8Array) {
    let msg
    try {
      msg = fromBinary(ServerMessageSchema, bytes)
    } catch {
      return
    }
    const now = Date.now()
    switch (msg.msg.case) {
      case 'telemetry': {
        const t = msg.msg.value
        this.stats.telemetry(t.seq, t.sentUnixNs, now)
        this.analytics.telemetry(t, now)
        this.frame = t
        if (t.mode !== this.state.mode || t.policy !== this.state.policy) this.publishSlow()
        if (!this.frameScheduled) {
          this.frameScheduled = true
          requestAnimationFrame(() => {
            this.frameScheduled = false
            for (const l of this.frameListeners) l()
          })
        }
        this.maybeReleaseStop(t.mode)
        break
      }
      case 'welcome': {
        const w = msg.msg.value
        this.jointIndex = new Map(w.robot?.joints.map((j, i) => [j.name, i]))
        this.stats.setExpectedHz(w.telemetryHz || 60)
        if (w.sessionId !== this.state.welcome?.sessionId) this.analytics.reset()
        this.attempt = 0
        const first = this.state.status !== 'live'
        // Within one sim session, a repeated Welcome (camera change, a reconnect, or the relay's cached copy) can carry a
        // stale mode; the telemetry-derived mode is current. Only a new session takes its mode from the Welcome.
        const sameSession = w.sessionId === this.state.welcome?.sessionId && this.state.mode !== Mode.UNSPECIFIED
        this.set({
          ...this.state,
          welcome: w,
          mode: sameSession ? this.state.mode : w.mode,
          policy: sameSession ? this.state.policy : '',
          status: 'live',
          error: null,
          liveSince: first ? now : this.state.liveSince,
        })
        if (first) this.addEvent(EventKind.INFO, 'Connected to the simulation')
        break
      }
      case 'session':
        // Role changes are announced by the relay as Event{ROLE}; the session info only updates state.
        this.set({ ...this.state, session: msg.msg.value })
        break
      case 'pong':
        if (msg.msg.value.clientId === this.clientId) this.stats.pong(Number(msg.msg.value.clientMs), msg.msg.value.serverUnixNs, now)
        break
      case 'event': {
        const e = msg.msg.value
        this.addEvent(e.kind, e.message)
        if (e.kind === EventKind.MODE && e.mode !== this.state.mode) this.set({ ...this.state, mode: e.mode })
        break
      }
    }
  }

  private publishSlow() {
    const t = this.frame
    const mode = t?.mode ?? this.state.mode
    const policy = t?.policy ?? this.state.policy
    this.set({
      ...this.state,
      telemetry: t,
      mode,
      policy,
      stats: this.stats.snapshot(Date.now()),
      analytics: this.analytics.snapshot(),
    })
  }

  private addEvent(kind: EventKind, message: string) {
    const events = [{ id: ++this.eventId, at: Date.now(), kind, message }, ...this.state.events].slice(0, MAX_EVENTS)
    this.set({ ...this.state, events })
  }

  clearEvents() {
    this.set({ ...this.state, events: [] })
  }

  private set(next: LiveState) {
    this.state = next
    for (const l of this.listeners) l()
  }
}
