import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { DurableObject } from 'cloudflare:workers'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  type CameraSpec,
  ClientMessageSchema,
  EventKind,
  EventSchema,
  type Hello,
  HelloSchema,
  Mode,
  ModeSchema,
  type ServerMessage,
  ServerMessageSchema,
  SessionInfoSchema,
  Role,
  type Welcome,
} from '../gen/noahos/sim/v1/sim_pb'

/**
 * One Durable Object per robot id (STACK.md §6.2). It owns the operator lock, fans the sim's bytes out to
 * every browser socket, and starts/stops the sim (Cloudflare Container in production, SIM_UPSTREAM locally).
 */

const IDLE_MS = 60_000
const CONTAINER_PORT = 8000
const SFU_BASE = 'https://rtc.live.cloudflare.com/v1/apps'
const MAX_MSGS_PER_SEC = 120
const UPSTREAM_RETRIES = 3
const UPSTREAM_RETRY_MS = 1000
/** Tag byte of `ServerMessage.telemetry` (field 4, length-delimited). The oneof is the only field, so byte 0 is its tag. */
const TELEMETRY_TAG = 0x22

type ClientState = {
  clientId: string
  role: Role
  divisor: number
  user: string
  /** Pairing token from Hello ('' when unpaired): sockets that share the lock holder's token are operators too. */
  pair: string
  /** True once the client has sent its Hello. */
  joined: boolean
}

type SimSession = { id: string; foxglovePort: number }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

const encode = (msg: ServerMessage['msg']) => toBinary(ServerMessageSchema, create(ServerMessageSchema, { msg }))

const encodeEvent = (kind: EventKind, message: string, extra: { mode?: Mode; operatorId?: string } = {}) =>
  encode({
    case: 'event',
    value: create(EventSchema, {
      kind,
      message,
      mode: extra.mode ?? Mode.UNSPECIFIED,
      operatorId: extra.operatorId ?? '',
      unixNs: BigInt(Date.now()) * 1_000_000n,
    }),
  })

export class RobotSession extends DurableObject<Env> {
  private robotId = ''
  private upstream: WebSocket | null = null
  private upstreamPromise: Promise<void> | null = null
  private welcome: Welcome | null = null
  private welcomeBytes: Uint8Array | null = null
  private mode: Mode = Mode.UNSPECIFIED
  private session: SimSession | null = null
  private frameNo = 0
  private dropped = 0
  private readonly states = new WeakMap<WebSocket, ClientState>()
  private readonly rates = new WeakMap<WebSocket, { windowStart: number; count: number }>()
  /** Last task cycle seen in this sim session; null until the first sample after a Welcome. */
  private lastCycle: number | null = null

  // ------------------------------------------------------------ daily output

  /** Completed task cycles per UTC day, kept in the DO's SQLite storage so they survive sessions and restarts. */
  private sqlReady = false
  private outputTable() {
    if (!this.sqlReady) {
      this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS output (day TEXT PRIMARY KEY, cycles INTEGER NOT NULL)')
      this.sqlReady = true
    }
    return this.ctx.storage.sql
  }

  private countCycle(cycle: number) {
    const prev = this.lastCycle
    this.lastCycle = cycle
    if (prev === null || cycle <= prev) return
    const day = new Date().toISOString().slice(0, 10)
    this.outputTable().exec(
      'INSERT INTO output (day, cycles) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET cycles = cycles + excluded.cycles',
      day,
      cycle - prev,
    )
  }

  /** The last 7 UTC days, oldest first, zero-filled. */
  private dailyOutput(): { day: string; cycles: number }[] {
    const rows = new Map(
      this.outputTable()
        .exec<{ day: string; cycles: number }>('SELECT day, cycles FROM output ORDER BY day DESC LIMIT 7')
        .toArray()
        .map((r) => [r.day, r.cycles]),
    )
    const days: { day: string; cycles: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
      days.push({ day, cycles: rows.get(day) ?? 0 })
    }
    return days
  }

  // ------------------------------------------------------------------ entry

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const m = url.pathname.match(/^\/(ws|api\/live)\/robots\/([^/]+)(\/.*)?$/)
    if (!m) return json({ error: 'not found' }, 404)
    const robotId = decodeURIComponent(m[2]!)
    await this.rememberRobot(robotId)

    if (m[1] === 'ws') {
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return json({ error: 'expected a WebSocket upgrade' }, 426)
      }
      return this.acceptClient(request, url)
    }

    const rest = m[3] ?? ''
    const method = request.method
    if (rest === '' && method === 'GET') return json(this.status())
    if (rest === '/cameras/subscribe' && method === 'POST') return this.camerasSubscribe()
    if (rest === '/cameras/answer' && method === 'PUT') return this.camerasAnswer(request)
    if (rest === '/foxglove' && method === 'GET') return this.foxglove(request)
    const ep = rest.match(/^\/episodes(?:\/([^/]+))?$/)
    if (ep && method === 'GET') return this.episodes(ep[1])
    if (rest === '/output' && method === 'GET') return json({ days: this.dailyOutput() })
    return json({ error: 'not found' }, 404)
  }

  private async rememberRobot(robotId: string) {
    if (this.robotId === robotId) return
    this.robotId = robotId
    await this.ctx.storage.put('robotId', robotId)
  }

  private async loadRobotId(): Promise<string> {
    if (!this.robotId) this.robotId = (await this.ctx.storage.get<string>('robotId')) ?? ''
    return this.robotId
  }

  private status() {
    const sockets = this.ctx.getWebSockets()
    const op = this.operator()
    return {
      live: this.upstream !== null && this.welcome !== null,
      clients: sockets.length,
      operatorId: op ? this.displayName(op) : '',
      mode: ModeSchema.value[this.mode]?.name.replace('MODE_', '').toLowerCase() ?? 'unspecified',
      cameras: (this.welcome?.cameras ?? []).map((c) => ({
        name: c.name,
        width: c.width,
        height: c.height,
        fps: c.fps,
        published: c.sfuSessionId !== '',
      })),
    }
  }

  // ------------------------------------------------------- browser sockets

  private acceptClient(request: Request, url: URL): Response {
    const requested = url.searchParams.get('client') ?? ''
    const clientId = /^[\w-]{8,64}$/.test(requested) ? requested : crypto.randomUUID()
    const user = (request.headers.get('x-noahos-user') ?? '').slice(0, 128)

    // A reconnecting browser reuses its client id: retire the stale socket first so the lock is not stuck on it.
    for (const old of this.ctx.getWebSockets(clientId)) {
      const st = this.state(old)
      this.setState(old, { ...st, role: Role.VIEWER, joined: false })
      old.close(1000, 'replaced by a newer connection')
    }

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server, [clientId])
    this.setState(server, { clientId, role: Role.VIEWER, divisor: 1, user, pair: '', joined: false })
    void this.ctx.storage.deleteAlarm()
    return new Response(null, { status: 101, webSocket: client })
  }

  private state(ws: WebSocket): ClientState {
    let st = this.states.get(ws)
    if (!st) {
      st = ws.deserializeAttachment() as ClientState
      this.states.set(ws, st)
    }
    return st
  }

  private setState(ws: WebSocket, st: ClientState) {
    this.states.set(ws, st)
    ws.serializeAttachment(st)
  }

  private displayName(ws: WebSocket) {
    const st = this.state(ws)
    return st.user || st.clientId
  }

  private operator(except?: WebSocket): WebSocket | undefined {
    return this.ctx.getWebSockets().find((w) => w !== except && this.state(w).role === Role.OPERATOR)
  }

  private rateLimited(ws: WebSocket): boolean {
    const now = Date.now()
    let r = this.rates.get(ws)
    if (!r || now - r.windowStart >= 1000) {
      r = { windowStart: now, count: 0 }
      this.rates.set(ws, r)
    }
    return ++r.count > MAX_MSGS_PER_SEC
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (this.rateLimited(ws)) {
      ws.close(1008, 'rate limit')
      return
    }
    if (typeof data === 'string') {
      this.dropped++
      return
    }
    const bytes = new Uint8Array(data)
    let msg
    try {
      msg = fromBinary(ClientMessageSchema, bytes)
    } catch {
      this.dropped++
      return
    }
    const st = this.state(ws)
    const body = msg.msg

    if (body.case === 'hello') {
      this.onHello(ws, st, body.value)
      return
    }
    if (!st.joined) {
      ws.send(encodeEvent(EventKind.DENIED, 'send Hello first'))
      return
    }

    switch (body.case) {
      case 'ping': {
        // The relay owns identity: route the Pong by the socket's own client id, never a client-supplied one.
        body.value.clientId = st.clientId
        await this.toSim(toBinary(ClientMessageSchema, create(ClientMessageSchema, { msg: body })), ws)
        return
      }
      case 'estop':
        await this.toSim(bytes, ws)
        return
      case 'jointTargets':
        // Safety: joints move only on the operator's command and only in Manual hold, never while a task runs.
        // The sim enforces the same rule; this refuses early and tells the browser why.
        if (st.role !== Role.OPERATOR) {
          ws.send(encodeEvent(EventKind.DENIED, 'only the operator can move joints'))
          return
        }
        if (this.mode !== Mode.MANUAL) {
          ws.send(encodeEvent(EventKind.DENIED, 'a policy is playing: pause it to move joints'))
          return
        }
        await this.toSim(bytes, ws)
        return
      case 'setMode':
      case 'recording':
        if (st.role !== Role.OPERATOR) {
          ws.send(encodeEvent(EventKind.DENIED, 'only the operator can send commands'))
          return
        }
        await this.toSim(bytes, ws)
        return
      default:
        this.dropped++
    }
  }

  private onHello(ws: WebSocket, st: ClientState, hello: Hello) {
    const hadLock = st.role === Role.OPERATOR
    const other = this.operator(ws)
    const pair = /^[\w-]{16,64}$/.test(hello.pairToken) ? hello.pairToken : ''
    // One operator person: a second device that presents the lock holder's pairing token shares the lock.
    const paired = other !== undefined && pair !== '' && this.state(other).pair === pair
    let role = Role.VIEWER
    if (hello.role === Role.OPERATOR && (!other || paired)) role = Role.OPERATOR
    const divisor = Math.min(60, Math.max(1, hello.telemetryDivisor || 1))
    this.setState(ws, { ...st, role, divisor, pair, joined: true })

    // Synchronous from here on so SessionInfo → Welcome ordering holds relative to telemetry broadcasts.
    this.broadcastSessionInfo()
    if (this.welcomeBytes) ws.send(this.welcomeBytes)
    if (role === Role.OPERATOR && !hadLock) {
      const who = this.state(ws).user || `client ${this.state(ws).clientId.slice(0, 8)}`
      this.broadcast(
        encodeEvent(EventKind.ROLE, paired ? `${who} joined as paired operator` : `${who} took control`, {
          operatorId: this.displayName(this.operator()!),
        }),
      )
    } else if (role !== Role.OPERATOR && hadLock && !other) {
      this.broadcast(encodeEvent(EventKind.ROLE, 'Control released', { operatorId: '' }))
    }
    this.ctx.waitUntil(
      this.ensureUpstream().catch((e) => {
        console.error('ensureUpstream failed', e)
        this.broadcast(encodeEvent(EventKind.ERROR, `sim unavailable: ${errorMessage(e)}`))
      }),
    )
  }

  /** SessionInfo to every joined client; `gone` is a closing socket that must not count or hold the lock. */
  private broadcastSessionInfo(gone?: WebSocket) {
    const sockets = this.ctx.getWebSockets().filter((w) => w !== gone)
    const op = this.operator(gone)
    const operatorId = op ? this.displayName(op) : ''
    for (const w of sockets) {
      const st = this.state(w)
      if (!st.joined) continue
      w.send(
        encode({
          case: 'session',
          value: create(SessionInfoSchema, {
            yourClientId: st.clientId,
            grantedRole: st.role,
            operatorId,
            clients: sockets.length,
          }),
        }),
      )
    }
  }

  private broadcast(bytes: Uint8Array) {
    for (const w of this.ctx.getWebSockets()) if (this.state(w).joined) w.send(bytes)
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    this.onClientGone(ws)
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.onClientGone(ws)
  }

  private onClientGone(ws: WebSocket) {
    const st = this.state(ws)
    const wasOperator = st.role === Role.OPERATOR
    this.setState(ws, { ...st, role: Role.VIEWER, joined: false })
    // The closing socket may still be listed until the runtime finishes tearing it down.
    if (this.ctx.getWebSockets().every((w) => w === ws)) {
      void this.ctx.storage.setAlarm(Date.now() + IDLE_MS)
      return
    }
    this.broadcastSessionInfo(ws)
    if (wasOperator && !this.operator(ws)) this.broadcast(encodeEvent(EventKind.ROLE, 'Control released', { operatorId: '' }))
  }

  // ------------------------------------------------------------- idle alarm

  override async alarm(): Promise<void> {
    if (this.ctx.getWebSockets().length > 0) return
    const robotId = await this.loadRobotId()
    const upstream = this.upstream
    this.upstream = null
    this.welcome = null
    this.welcomeBytes = null
    this.mode = Mode.UNSPECIFIED
    try {
      upstream?.close(1000, 'idle')
    } catch {
      // already closed
    }
    const session = this.session ?? (await this.ctx.storage.get<SimSession>('session')) ?? null
    this.session = null
    await this.ctx.storage.delete('session')
    const container = this.ctx.container
    const containerRunning = !this.env.SIM_UPSTREAM && container?.running
    if (session && (this.env.SIM_UPSTREAM || containerRunning)) {
      await this.simFetch(`/sessions/${session.id}`, { method: 'DELETE' }).catch(() => undefined)
    }
    if (containerRunning) await container!.destroy()
    console.log(JSON.stringify({ event: 'idle-teardown', robot: robotId }))
  }

  // ------------------------------------------------------- sim: transport

  private simHeaders(extra?: HeadersInit): Headers {
    const h = new Headers(extra)
    if (this.env.SIM_SHARED_SECRET) h.set('authorization', `Bearer ${this.env.SIM_SHARED_SECRET}`)
    return h
  }

  /** Request to the sim orchestrator: SIM_UPSTREAM origin locally, the container's :8000 in production. */
  private async simFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = this.simHeaders(init.headers)
    if (this.env.SIM_UPSTREAM) {
      return fetch(new URL(path, this.env.SIM_UPSTREAM), { ...init, headers })
    }
    await this.ensureContainer()
    return this.ctx.container!.getTcpPort(CONTAINER_PORT).fetch(`http://sim${path}`, { ...init, headers })
  }

  private containerReady: Promise<void> | null = null

  private ensureContainer(): Promise<void> {
    this.containerReady ??= this.startContainer().finally(() => {
      this.containerReady = null
    })
    return this.containerReady
  }

  private async startContainer() {
    const container = this.ctx.container
    if (!container) throw new Error('no sim backend: set SIM_UPSTREAM or deploy with a container binding')
    if (!container.running) {
      const env: Record<string, string> = {}
      for (const k of ['SIM_SHARED_SECRET', 'CF_REALTIME_APP_ID', 'CF_REALTIME_APP_SECRET', 'SIM_TELEMETRY_HZ'] as const) {
        const v = this.env[k]
        if (v) env[k] = v
      }
      const ice = await this.iceServers()
      if (ice) env.SIM_ICE_SERVERS = ice
      container.start({ env, enableInternet: true })
      await container.setInactivityTimeout(120_000)
    }
    for (let i = 0; i < 100; i++) {
      try {
        const r = await container.getTcpPort(CONTAINER_PORT).fetch('http://sim/healthz')
        if (r.ok) return
        await r.body?.cancel()
      } catch {
        // not listening yet
      }
      await sleep(200)
    }
    throw new Error('sim container did not become healthy in 20 s')
  }

  /**
   * Short-lived Cloudflare TURN credentials for the sim's publisher (STACK.md §3.2); falls back to the static SIM_ICE_SERVERS.
   * Never throws: a TURN outage may cost the cameras, but telemetry and the twin must still start.
   */
  private async iceServers(): Promise<string | undefined> {
    const { TURN_KEY_ID, TURN_KEY_API_TOKEN, SIM_ICE_SERVERS } = this.env
    const fallback = SIM_ICE_SERVERS || undefined
    if (!TURN_KEY_ID || !TURN_KEY_API_TOKEN) return fallback
    try {
      const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ttl: 86400 }),
      })
      if (!r.ok) {
        console.log(JSON.stringify({ event: 'turn-credentials-failed', status: r.status }))
        await r.body?.cancel()
        return fallback
      }
      const { iceServers } = await r.json<{ iceServers: unknown[] }>()
      return JSON.stringify(iceServers)
    } catch (e) {
      console.log(JSON.stringify({ event: 'turn-credentials-failed', error: String(e) }))
      return fallback
    }
  }

  private async ensureSession(): Promise<SimSession> {
    const robotId = await this.loadRobotId()
    const r = await this.simFetch('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ robot_id: robotId }),
    })
    if (!r.ok) throw new Error(`POST /sessions → ${r.status} ${(await r.text()).slice(0, 200)}`)
    const body = (await r.json()) as { id: string; foxglove_port: number }
    this.session = { id: body.id, foxglovePort: body.foxglove_port }
    await this.ctx.storage.put('session', this.session)
    return this.session
  }

  /** Single-flighted: concurrent callers share one connection attempt. */
  private ensureUpstream(): Promise<void> {
    if (this.upstream) return Promise.resolve()
    this.upstreamPromise ??= this.connectUpstream().finally(() => {
      this.upstreamPromise = null
    })
    return this.upstreamPromise
  }

  private async connectUpstream() {
    const session = await this.ensureSession()
    const r = await this.simFetch(`/sessions/${session.id}/ws`, { headers: { upgrade: 'websocket' } })
    const ws = r.webSocket
    if (!ws) throw new Error(`sim WebSocket upgrade failed: ${r.status}`)
    ws.accept()
    // The standard default is "blob"; the relay forwards raw bytes and wants ArrayBuffers.
    ws.binaryType = 'arraybuffer'
    this.upstream = ws
    ws.addEventListener('message', (e) => this.onUpstreamMessage(ws, e.data))
    ws.addEventListener('close', () => this.onUpstreamGone(ws))
    ws.addEventListener('error', () => this.onUpstreamGone(ws))
    ws.send(
      toBinary(
        ClientMessageSchema,
        create(ClientMessageSchema, {
          msg: { case: 'hello', value: create(HelloSchema, { clientId: 'relay', role: Role.OPERATOR, telemetryDivisor: 1 }) },
        }),
      ),
    )
  }

  private onUpstreamMessage(ws: WebSocket, data: unknown) {
    if (ws !== this.upstream || !(data instanceof ArrayBuffer)) return
    const bytes = new Uint8Array(data)
    if (bytes[0] === TELEMETRY_TAG) {
      const n = this.frameNo++
      // Track the mode for /api/live status at ~10 Hz; Event{MODE} below covers changes between samples.
      if (n % 6 === 0) {
        try {
          const m = fromBinary(ServerMessageSchema, bytes).msg
          if (m.case === 'telemetry') {
            this.mode = m.value.mode
            this.countCycle(m.value.taskCycle)
          }
        } catch {
          // keep last mode
        }
      }
      for (const w of this.ctx.getWebSockets()) {
        const st = this.state(w)
        if (st.joined && n % st.divisor === 0) w.send(bytes)
      }
      return
    }
    let msg: ServerMessage
    try {
      msg = fromBinary(ServerMessageSchema, bytes)
    } catch {
      this.dropped++
      return
    }
    switch (msg.msg.case) {
      case 'welcome':
        // A new or restarted sim session starts counting task cycles from zero again.
        if (msg.msg.value.sessionId !== this.welcome?.sessionId) this.lastCycle = null
        this.welcome = msg.msg.value
        this.welcomeBytes = bytes
        this.mode = msg.msg.value.mode
        this.broadcast(bytes)
        break
      case 'pong':
        for (const w of this.ctx.getWebSockets(msg.msg.value.clientId)) w.send(bytes)
        break
      case 'event':
        if (msg.msg.value.kind === EventKind.MODE) this.mode = msg.msg.value.mode
        this.broadcast(bytes)
        break
      default:
        this.broadcast(bytes)
    }
  }

  private onUpstreamGone(ws: WebSocket) {
    if (ws !== this.upstream) return
    this.upstream = null
    this.welcome = null
    this.welcomeBytes = null
    if (this.ctx.getWebSockets().length === 0) return
    this.ctx.waitUntil(this.reconnectUpstream())
  }

  private async reconnectUpstream() {
    let lastError: unknown
    for (let i = 0; i < UPSTREAM_RETRIES; i++) {
      await sleep(UPSTREAM_RETRY_MS)
      if (this.ctx.getWebSockets().length === 0) return
      try {
        await this.ensureUpstream()
        this.broadcast(encodeEvent(EventKind.INFO, 'sim reconnected'))
        return
      } catch (e) {
        lastError = e
      }
    }
    console.error('sim reconnect failed', lastError)
    this.broadcast(encodeEvent(EventKind.ERROR, 'sim disconnected'))
    for (const w of this.ctx.getWebSockets()) w.close(1011, 'sim disconnected')
  }

  private async toSim(bytes: Uint8Array, from: WebSocket) {
    try {
      await this.ensureUpstream()
      this.upstream?.send(bytes)
    } catch (e) {
      from.send(encodeEvent(EventKind.ERROR, `sim unavailable: ${errorMessage(e)}`))
    }
  }

  // ----------------------------------------------------------- HTTP routes

  private sfu(path: string, init: RequestInit = {}) {
    return fetch(`${SFU_BASE}/${this.env.CF_REALTIME_APP_ID}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.env.CF_REALTIME_APP_SECRET}`,
        'content-type': 'application/json',
      },
    })
  }

  private sfuReady() {
    return Boolean(this.env.CF_REALTIME_APP_ID && this.env.CF_REALTIME_APP_SECRET)
  }

  private async camerasSubscribe(): Promise<Response> {
    if (!this.sfuReady()) return json({ error: 'Camera stream unavailable: no Realtime credentials' }, 503)
    const cameras: CameraSpec[] = (this.welcome?.cameras ?? []).filter((c) => c.sfuSessionId !== '')
    if (cameras.length === 0) return json({ error: 'No cameras are published for this robot' }, 503)

    const created = await this.sfu('/sessions/new', { method: 'POST' })
    if (!created.ok) return json({ error: `SFU sessions/new → ${created.status}` }, 502)
    const { sessionId } = (await created.json()) as { sessionId: string }

    const res = await this.sfu(`/sessions/${sessionId}/tracks/new`, {
      method: 'POST',
      body: JSON.stringify({
        tracks: cameras.map((c) => ({ location: 'remote', sessionId: c.sfuSessionId, trackName: c.trackName })),
      }),
    })
    const out = (await res.json()) as {
      errorCode?: string
      errorDescription?: string
      requiresImmediateRenegotiation?: boolean
      sessionDescription?: { type: string; sdp: string }
      tracks?: { mid?: string; trackName?: string; errorCode?: string; errorDescription?: string }[]
    }
    if (!res.ok || out.errorCode) {
      return json({ error: `SFU tracks/new failed: ${out.errorDescription ?? res.status}` }, 502)
    }
    const bad = out.tracks?.find((t) => t.errorCode)
    if (bad) return json({ error: `SFU track ${bad.trackName} failed: ${bad.errorDescription ?? bad.errorCode}` }, 502)
    return json({
      sessionId,
      sessionDescription: out.sessionDescription,
      tracks: (out.tracks ?? []).map((t) => ({ mid: t.mid, trackName: t.trackName })),
      requiresImmediateRenegotiation: out.requiresImmediateRenegotiation ?? false,
    })
  }

  private async camerasAnswer(request: Request): Promise<Response> {
    if (!this.sfuReady()) return json({ error: 'Camera stream unavailable: no Realtime credentials' }, 503)
    let body: { sessionId?: string; sessionDescription?: { type?: string; sdp?: string } }
    try {
      body = await request.json()
    } catch {
      return json({ error: 'invalid JSON' }, 400)
    }
    if (!body.sessionId || !/^[\w-]+$/.test(body.sessionId) || !body.sessionDescription?.sdp) {
      return json({ error: 'sessionId and sessionDescription are required' }, 400)
    }
    const res = await this.sfu(`/sessions/${body.sessionId}/renegotiate`, {
      method: 'PUT',
      body: JSON.stringify({ sessionDescription: { type: 'answer', sdp: body.sessionDescription.sdp } }),
    })
    if (!res.ok) return json({ error: `SFU renegotiate → ${res.status}` }, 502)
    await res.body?.cancel()
    return new Response(null, { status: 204 })
  }

  private async episodes(file: string | undefined): Promise<Response> {
    try {
      const session = await this.ensureSession()
      if (this.ctx.getWebSockets().length === 0) await this.ctx.storage.setAlarm(Date.now() + IDLE_MS)
      const r = await this.simFetch(`/sessions/${session.id}/episodes${file ? `/${encodeURIComponent(file)}` : ''}`)
      const headers = new Headers()
      for (const h of ['content-type', 'content-length', 'content-disposition']) {
        const v = r.headers.get(h)
        if (v) headers.set(h, v)
      }
      return new Response(r.body, { status: r.status, headers })
    } catch (e) {
      return json({ error: `sim unavailable: ${errorMessage(e)}` }, 502)
    }
  }

  /** Foxglove WebSocket pass-through to the session's bridge port (best effort locally: same host as SIM_UPSTREAM). */
  private async foxglove(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return json({ error: 'expected a WebSocket upgrade' }, 426)
    }
    try {
      const session = this.session ?? (await this.ensureSession())
      if (this.env.SIM_UPSTREAM) {
        const target = new URL(this.env.SIM_UPSTREAM)
        target.port = String(session.foxglovePort)
        target.pathname = '/'
        return fetch(new Request(target, request))
      }
      await this.ensureContainer()
      return this.ctx.container!.getTcpPort(session.foxglovePort).fetch(request)
    } catch (e) {
      return json({ error: `sim unavailable: ${errorMessage(e)}` }, 502)
    }
  }
}
