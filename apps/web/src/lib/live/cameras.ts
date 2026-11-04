/** Subscribes to the sim's camera tracks on Cloudflare Realtime SFU through the Worker (STACK.md §3.2, §6.1). */

export type CameraStats = {
  /** Mean jitter-buffer delay, ms. */
  jitterBufferMs: number | null
  /** Mean decode time per frame, ms. */
  decodeMs: number | null
  lost: number
  fps: number | null
  kbps: number | null
}

export type CameraFeed = { name: string; stream: MediaStream; stats: CameraStats }
export type CameraStatus = 'idle' | 'connecting' | 'streaming' | 'unavailable' | 'error'
export type CameraState = { status: CameraStatus; message: string | null; feeds: CameraFeed[] }

type SubscribeResponse = {
  sessionId: string
  sessionDescription: RTCSessionDescriptionInit
  tracks: { mid: string; trackName: string }[]
}

const EMPTY_STATS: CameraStats = { jitterBufferMs: null, decodeMs: null, lost: 0, fps: null, kbps: null }
const STATS_MS = 1000
const GATHER_MS = 1000

function isSubscribeResponse(v: unknown): v is SubscribeResponse {
  return (
    !!v &&
    typeof v === 'object' &&
    'sessionId' in v &&
    typeof v.sessionId === 'string' &&
    'sessionDescription' in v &&
    'tracks' in v &&
    Array.isArray(v.tracks)
  )
}

async function errorText(r: Response): Promise<string> {
  try {
    const body: unknown = await r.json()
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error
  } catch {
    /* not JSON */
  }
  return `HTTP ${r.status}`
}

export class CameraSubscriber {
  private pc: RTCPeerConnection | null = null
  private state: CameraState = { status: 'idle', message: null, feeds: [] }
  private listeners = new Set<() => void>()
  private timer: number | undefined
  private bytes = new Map<string, { bytes: number; at: number }>()
  private generation = 0

  constructor(private readonly robotId: string) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  get = () => this.state

  async start() {
    const gen = ++this.generation
    this.teardown()
    this.set({ status: 'connecting', message: null, feeds: [] })
    try {
      const base = `/api/live/robots/${encodeURIComponent(this.robotId)}/cameras`
      const r = await fetch(`${base}/subscribe`, { method: 'POST' })
      if (r.status === 503) {
        const message = await errorText(r)
        if (gen === this.generation) this.set({ status: 'unavailable', message, feeds: [] })
        return
      }
      if (!r.ok) throw new Error(await errorText(r))
      const body: unknown = await r.json()
      if (!isSubscribeResponse(body)) throw new Error('Unexpected subscribe response')
      if (gen !== this.generation) return

      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }], bundlePolicy: 'max-bundle' })
      this.pc = pc
      const names = new Map(body.tracks.map((t) => [t.mid, t.trackName]))
      const order = body.tracks.map((t) => t.trackName)
      pc.ontrack = (e) => {
        const name = (e.transceiver.mid && names.get(e.transceiver.mid)) || e.track.id
        const stream = e.streams[0] ?? new MediaStream([e.track])
        const feeds = [...this.state.feeds.filter((f) => f.name !== name), { name, stream, stats: EMPTY_STATS }]
        feeds.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
        this.set({ ...this.state, status: 'streaming', feeds })
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') this.set({ ...this.state, status: 'error', message: 'Camera connection failed' })
      }
      await pc.setRemoteDescription(body.sessionDescription)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      await gathered(pc)
      const put = await fetch(`${base}/answer`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: body.sessionId, sessionDescription: pc.localDescription }),
      })
      if (!put.ok) throw new Error(await errorText(put))
      if (gen === this.generation) this.timer = window.setInterval(() => void this.sample(), STATS_MS)
    } catch (e) {
      if (gen === this.generation)
        this.set({ status: 'error', message: e instanceof Error ? e.message : String(e), feeds: [] })
    }
  }

  stop() {
    this.generation++
    this.teardown()
    this.set({ status: 'idle', message: null, feeds: [] })
  }

  private teardown() {
    clearInterval(this.timer)
    this.pc?.close()
    this.pc = null
    this.bytes.clear()
  }

  private async sample() {
    const pc = this.pc
    if (!pc) return
    const report = await pc.getStats()
    const byMid = new Map<string, CameraStats>()
    const now = performance.now()
    report.forEach((s: RTCStats) => {
      if (s.type !== 'inbound-rtp') return
      const r = s as RTCInboundRtpStreamStats
      if (r.kind !== 'video' || !r.mid) return
      const emitted = r.jitterBufferEmittedCount ?? 0
      const decoded = r.framesDecoded ?? 0
      const prev = this.bytes.get(r.mid)
      const bytes = r.bytesReceived ?? 0
      this.bytes.set(r.mid, { bytes, at: now })
      byMid.set(r.mid, {
        jitterBufferMs: emitted ? ((r.jitterBufferDelay ?? 0) / emitted) * 1000 : null,
        decodeMs: decoded ? ((r.totalDecodeTime ?? 0) / decoded) * 1000 : null,
        lost: r.packetsLost ?? 0,
        fps: r.framesPerSecond ?? null,
        kbps: prev && now > prev.at ? ((bytes - prev.bytes) * 8) / (now - prev.at) : null,
      })
    })
    const midOf = new Map(pc.getTransceivers().map((t) => [t.receiver.track.id, t.mid]))
    const feeds = this.state.feeds.map((f) => {
      const mid = midOf.get(f.stream.getVideoTracks()[0]?.id ?? '')
      return { ...f, stats: (mid && byMid.get(mid)) || f.stats }
    })
    this.set({ ...this.state, feeds })
  }

  private set(next: CameraState) {
    this.state = next
    for (const l of this.listeners) l()
  }
}

function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    const check = () => pc.iceGatheringState === 'complete' && done()
    pc.addEventListener('icegatheringstatechange', check)
    setTimeout(done, GATHER_MS)
  })
}
