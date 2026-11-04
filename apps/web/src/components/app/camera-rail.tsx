import { IconButton, InlineLoading, Modal, Theme } from '@carbon/react'
import { Close, Maximize, Popup } from '@carbon/icons-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'

import type { CameraSpec } from '@/gen/noahos/sim/v1/sim_pb'
import type { CameraFeed, CameraState } from '@/lib/live/cameras'
import { CameraVideo } from './camera-video'
import { humanize } from './control-state'

type Rect = { x: number; y: number; w: number; h: number }

const PIP_MIN_W = 200
const PIP_DEFAULT_W = 360
const HEADER_H = 32 // matches .camera-pip__head (2rem)

export type CameraWindowsState = { expanded: string | null; pips: Record<string, Rect> }
export type CameraWindowsApi = { enlarge(name: string): void; popOut(name: string): void }

const feedOf = (state: CameraState, name: string) => state.feeds.find((f) => f.name === name) ?? null

/**
 * Open camera windows (the Enlarge dialog and the floating picture-in-picture windows), owned by the Control page so
 * they survive switching the right panel to a joint or changing tabs. Pass `active = false` to close them all (live
 * view ended).
 */
export function useCameraWindows(cameras: CameraSpec[], active: boolean) {
  const [state, setState] = useState<CameraWindowsState>({ expanded: null, pips: {} })
  useEffect(() => {
    if (!active) setState({ expanded: null, pips: {} })
  }, [active])
  const api: CameraWindowsApi = {
    enlarge: (name) => setState((s) => ({ ...s, expanded: name })),
    popOut: (name) =>
      setState((s) => {
        if (s.pips[name]) return s
        const c = cameras.find((x) => x.name === name)
        const w = PIP_DEFAULT_W
        const h = Math.round((w * (c?.height || 240)) / (c?.width || 320)) + HEADER_H
        const n = Object.keys(s.pips).length
        const rect = { x: window.innerWidth - w - 24 - n * 24, y: window.innerHeight - h - 24 - n * 24, w, h }
        return { ...s, pips: { ...s.pips, [name]: rect } }
      }),
  }
  return { state, setState, api }
}

/**
 * Right-panel camera list while live (STACK.md §7.4): one card per camera the sim publishes for this model, each with
 * Picture in picture and Enlarge. The windows themselves are rendered by `CameraWindows` at page level.
 */
export function CameraRail({ cameras, state, windows }: { cameras: CameraSpec[]; state: CameraState; windows: CameraWindowsApi }) {
  return (
    <section className="camera-rail" aria-label="Robot cameras">
      <h2 className="camera-rail__title">Cameras</h2>
      {cameras.length === 0 && <p className="camera-rail__empty">This model has no cameras.</p>}
      {cameras.map((c) => {
        const feed = feedOf(state, c.name)
        return (
          <div key={c.name} className="camera-card">
            <div className="camera-card__media">
              <CameraMedia feed={feed} spec={c} state={state} />
              <div className="camera-card__actions">
                <IconButton kind="ghost" size="sm" align="bottom-end" label="Picture in picture" disabled={!feed} onClick={() => windows.popOut(c.name)}>
                  <Popup />
                </IconButton>
                <IconButton kind="ghost" size="sm" align="bottom-end" label="Enlarge" disabled={!feed} onClick={() => windows.enlarge(c.name)}>
                  <Maximize />
                </IconButton>
              </div>
            </div>
            <p className="camera-card__name">{humanize(c.name)}</p>
          </div>
        )
      })}
    </section>
  )
}

/** The Enlarge dialog and the floating PiP windows, portalled to <body> with the app's theme so they float over the page. */
export function CameraWindows({
  cameras,
  state,
  windows,
  setWindows,
}: {
  cameras: CameraSpec[]
  state: CameraState
  windows: CameraWindowsState
  setWindows: Dispatch<SetStateAction<CameraWindowsState>>
}) {
  const { expanded, pips } = windows
  const close = () => setWindows((s) => ({ ...s, expanded: null }))
  const closePip = (name: string) =>
    setWindows((s) => {
      const { [name]: _closed, ...rest } = s.pips
      return { ...s, pips: rest }
    })
  const movePip = useCallback(
    (name: string, rect: Rect) => setWindows((s) => (s.pips[name] ? { ...s, pips: { ...s.pips, [name]: rect } } : s)),
    [setWindows],
  )

  // Esc closes the enlarged view. Listened for in the capture phase: the modal is portalled but still inside the page's
  // React tree, and an ancestor's key handler stops the event before it reaches Carbon's document-level Esc listener.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setWindows((s) => ({ ...s, expanded: null }))
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [expanded, setWindows])

  const expandedFeed = expanded ? feedOf(state, expanded) : null
  const expandedSpec = expanded ? cameras.find((c) => c.name === expanded) : undefined
  if (typeof document === 'undefined') return null
  return createPortal(
    <Theme theme="white">
      <Modal
        open={expanded !== null}
        passiveModal
        size="lg"
        modalHeading={expanded ? humanize(expanded) : ''}
        modalLabel={expandedSpec ? `${expandedSpec.width}×${expandedSpec.height} · ${expandedSpec.fps} fps` : undefined}
        onRequestClose={close}
      >
        {expandedFeed && <CameraVideo className="camera-modal__video" feed={expandedFeed} label={`${expanded} camera, enlarged`} />}
      </Modal>
      {Object.entries(pips).map(([name, rect]) => {
        const feed = feedOf(state, name)
        return feed ? <PipWindow key={name} name={name} feed={feed} rect={rect} onMove={movePip} onClose={() => closePip(name)} /> : null
      })}
    </Theme>,
    document.body,
  )
}

function CameraMedia({ feed, spec, state }: { feed: CameraFeed | null; spec: CameraSpec; state: CameraState }) {
  if (feed) return <CameraVideo className="camera-card__video" feed={feed} label={`${spec.name} camera`} />
  return (
    <div className="camera-card__placeholder">
      {state.status === 'connecting' ? (
        <InlineLoading description="Connecting…" />
      ) : (
        <span>{!spec.sfuSessionId ? 'Stream unavailable' : (state.message ?? 'Waiting for video')}</span>
      )}
    </div>
  )
}

/** Floating window over the page: drag by the title bar, resize from the bottom-right corner; kept inside the viewport. */
function PipWindow({ name, feed, rect, onMove, onClose }: { name: string; feed: CameraFeed; rect: Rect; onMove(name: string, rect: Rect): void; onClose(): void }) {
  const drag = useRef<{ kind: 'move' | 'resize'; px: number; py: number; start: Rect; aspect: number } | null>(null)

  const begin = (kind: 'move' | 'resize') => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (kind === 'move' && e.target instanceof Element && e.target.closest('button'))) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { kind, px: e.clientX, py: e.clientY, start: rect, aspect: (rect.h - HEADER_H) / rect.w }
  }
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.px
    const dy = e.clientY - d.py
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (d.kind === 'move') {
      onMove(name, { ...d.start, x: clamp(d.start.x + dx, 0, vw - d.start.w), y: clamp(d.start.y + dy, 0, vh - d.start.h) })
    } else {
      // Keep the camera's aspect ratio: width follows the larger of the two pointer moves.
      const w = clamp(Math.max(d.start.w + dx, d.start.w + dy / d.aspect), PIP_MIN_W, vw - d.start.x)
      onMove(name, { ...d.start, w, h: Math.round(w * d.aspect) + HEADER_H })
    }
  }
  const end = () => (drag.current = null)

  return (
    <div
      className="camera-pip"
      role="dialog"
      aria-label={`${humanize(name)} camera, picture in picture`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div className="camera-pip__head" onPointerDown={begin('move')} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        <span className="camera-pip__title">{humanize(name)}</span>
        <IconButton kind="ghost" size="sm" align="bottom-end" label="Close picture in picture" onClick={onClose}>
          <Close />
        </IconButton>
      </div>
      <CameraVideo className="camera-pip__video" feed={feed} label={`${name} camera`} />
      <span
        className="camera-pip__resize"
        aria-hidden="true"
        onPointerDown={begin('resize')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  )
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
