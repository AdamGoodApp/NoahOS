import { Add, ArrowRight, Close, Send, StopFilledAlt } from '@carbon/icons-react'
import { fetchServerSentEvents, useChat, useRegisterWebMCPTools } from '@tanstack/ai-react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'

import { closeAssistant, useAssistantOpen } from '@/lib/agent/assistant-store'
import { clientTools, webmcpToolOptions, type AgentContext, type AgentTarget } from '@/lib/agent/client-tools'
import { EXAMPLE_TABS } from '@/lib/agent/examples'
import { pageContextFor } from '@/lib/agent/page-context'
import { useCapability } from '@/lib/agent/registry'
import { authClient } from '@/lib/auth-client'
import { AssistantMessage } from './assistant-message'

const connection = fetchServerSentEvents('/api/chat')

const noSubscribe = () => () => {}

const LIVE_ONLY = 'The assistant runs on the live site only.'
const SIGN_IN = 'Sign in to use the assistant.'

function errorText(error: Error): string {
  const status = 'status' in error ? error.status : undefined
  if (status === 401) return SIGN_IN
  if (status === 503) return LIVE_ONLY
  if (status === 429) return 'Too many messages. Wait a minute, then try again.'
  return error.message || 'The assistant could not answer. Try again.'
}

/** Site-wide assistant: mounted once at the root, so the conversation survives navigation and closing the panel. */
export function AssistantPanel() {
  const open = useAssistantOpen()
  const pathname = useLocation({ select: (l) => l.pathname })
  const { page, path, robotId } = pageContextFor(pathname)

  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const context = useMemo<AgentContext>(
    () => ({
      navigate: (target: AgentTarget) => {
        const go = navigateRef.current
        if (target.page === 'fleet') return go({ to: '/app' })
        return go({ to: '/app/robots/$id', params: { id: target.robotId } })
      },
    }),
    [],
  )

  const webmcpOptions = useMemo(
    () => ({
      context,
      toolOptions: webmcpToolOptions,
      onError: (error: unknown) => console.log(JSON.stringify({ event: 'webmcp-register-failed', error: String(error) })),
    }),
    [context],
  )
  useRegisterWebMCPTools(clientTools, webmcpOptions)

  // The panel covers the Control page's header Stop, so while that robot is live the panel has its own one-click Stop
  // (straight to the live client, no model round trip).
  const control = useCapability('control')
  const liveStatus = useSyncExternalStore(
    control?.subscribe ?? noSubscribe,
    () => control?.liveStatus() ?? 'idle',
    () => 'idle' as const,
  )
  const showStop = control !== null && liveStatus !== 'idle' && liveStatus !== 'error'

  const [threadId, setThreadId] = useState(() => crypto.randomUUID())
  const forwardedProps = useMemo(() => ({ page, path, robotId }), [page, path, robotId])
  const { messages, sendMessage, isLoading, error, stop } = useChat({
    connection,
    threadId,
    tools: clientTools,
    context,
    forwardedProps,
  })

  const session = authClient.useSession()
  const signedIn = Boolean(session.data)
  const [available, setAvailable] = useState<boolean | null>(null)
  useEffect(() => {
    if (!open || available !== null) return
    fetch('/api/chat')
      .then((r) => r.json() as Promise<{ available?: boolean }>)
      .then((j) => setAvailable(j.available === true))
      .catch(() => setAvailable(false))
  }, [open, available])

  const [tab, setTab] = useState(0)
  const [draft, setDraft] = useState('')
  const canSend = signedIn && available !== false
  const send = (text: string) => {
    const content = text.trim()
    if (!content || !canSend || isLoading) return
    setDraft('')
    void sendMessage(content)
  }
  const newChat = () => {
    stop()
    setThreadId(crypto.randomUUID())
  }

  // Opening moves focus into the panel (the composer, else Close). Focus waits until the session and the availability
  // probe have answered, so it never lands on a composer that is about to be disabled.
  const panel = useRef<HTMLElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const settled = !session.isPending && (!signedIn || available !== null)
  const focusPending = useRef(false)
  useEffect(() => {
    focusPending.current = open
  }, [open])
  useEffect(() => {
    if (!open || !settled || !focusPending.current) return
    focusPending.current = false
    ;(input.current && !input.current.disabled ? input.current : closeButton.current)?.focus()
  }, [open, settled])

  // Escape closes the panel when focus is in it, on a toggle (header action, launcher) or nowhere in particular;
  // elsewhere Escape keeps its page meaning (closing a menu, clearing a selection).
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const active = document.activeElement
      if (active === document.body || panel.current?.contains(active) || active?.closest('[data-assistant-toggle]')) closeAssistant()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const onComposerKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send(draft)
    }
  }

  const activeTab = EXAMPLE_TABS[tab] ?? EXAMPLE_TABS[0]
  const last = messages.at(-1)

  return (
    <aside
      ref={panel}
      className="assistant-panel"
      data-open={open}
      data-shell={page === 'fleet' || page === 'control' ? 'app' : 'site'}
      aria-label="Assistant"
      aria-hidden={!open}
      inert={!open}
    >
      <header className="assistant-head">
        <h2>Assistant</h2>
        {showStop && (
          <button type="button" className="assistant-stop" onClick={() => control.stop()}>
            <StopFilledAlt size={16} aria-hidden="true" />
            Stop
          </button>
        )}
        <button type="button" className="assistant-icon-btn" aria-label="New chat" title="New chat" onClick={newChat}>
          <Add size={20} />
        </button>
        <button ref={closeButton} type="button" className="assistant-icon-btn" aria-label="Close" title="Close" onClick={closeAssistant}>
          <Close size={20} />
        </button>
      </header>

      <div className="assistant-body" ref={list}>
        {!signedIn && !session.isPending ? (
          <div className="assistant-gate">
            <p>{SIGN_IN}</p>
            <a className="assistant-btn--primary" href={`/auth/sign-in?redirect=${encodeURIComponent(path)}`}>
              Sign in
            </a>
          </div>
        ) : messages.length === 0 ? (
          <div className="assistant-hello">
            <p className="assistant-hello__title">What should we do?</p>
            <p className="assistant-hello__lead">I can open robots, move joints, run simulations and explain what you see.</p>
            <div className="assistant-tabs" role="tablist" aria-label="Examples">
              {EXAMPLE_TABS.map((t, i) => (
                <button
                  key={t.label}
                  type="button"
                  role="tab"
                  id={`assistant-tab-${i}`}
                  aria-selected={i === tab}
                  aria-controls="assistant-examples"
                  tabIndex={i === tab ? 0 : -1}
                  onClick={() => setTab(i)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                    const next = (i + (e.key === 'ArrowRight' ? 1 : -1) + EXAMPLE_TABS.length) % EXAMPLE_TABS.length
                    setTab(next)
                    document.getElementById(`assistant-tab-${next}`)?.focus()
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <ul id="assistant-examples" className="assistant-examples" role="tabpanel" aria-labelledby={`assistant-tab-${tab}`}>
              {activeTab?.examples.map((ex) => (
                <li key={ex.prompt}>
                  <button type="button" className="assistant-example" disabled={!canSend} onClick={() => send(ex.prompt)}>
                    <span className="assistant-example__text">
                      <span className="assistant-example__prompt">{ex.prompt}</span>
                      <span className="assistant-example__hint">{ex.hint}</span>
                    </span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <ol className="assistant-messages" aria-live="polite">
            {messages.map((m) => (
              <AssistantMessage key={m.id} message={m} streaming={isLoading && m === last} />
            ))}
            {isLoading && last?.role === 'user' && (
              <li className="assistant-msg assistant-msg--assistant">
                <p className="assistant-pending">…</p>
              </li>
            )}
          </ol>
        )}
      </div>

      <footer className="assistant-foot">
        {available === false && signedIn && <p className="assistant-notice">{LIVE_ONLY}</p>}
        {error && available !== false && <p className="assistant-notice assistant-notice--error">{errorText(error)}</p>}
        <form
          className="assistant-composer"
          onSubmit={(e) => {
            e.preventDefault()
            send(draft)
          }}
        >
          <label htmlFor="assistant-input" className="assistant-sr-only">
            Message
          </label>
          <textarea
            ref={input}
            id="assistant-input"
            rows={1}
            value={draft}
            placeholder="Ask or tell the assistant what to do"
            disabled={!canSend}
            onChange={(e) => {
              setDraft(e.target.value)
              const el = e.target
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }}
            onKeyDown={onComposerKey}
          />
          {isLoading ? (
            <button type="button" className="assistant-send" aria-label="Stop" title="Stop" onClick={stop}>
              <StopFilledAlt size={16} />
            </button>
          ) : (
            <button type="submit" className="assistant-send" aria-label="Send" title="Send" disabled={!canSend || !draft.trim()}>
              <Send size={16} />
            </button>
          )}
        </form>
        <p className="assistant-helper">The assistant can move robots. Stop halts them.</p>
      </footer>
    </aside>
  )
}
