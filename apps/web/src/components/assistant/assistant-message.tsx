import { CheckmarkFilled, ChevronRight, ErrorFilled } from '@carbon/icons-react'
import type { UIMessage } from '@tanstack/ai-react'

import { stepLabel } from '@/lib/agent/labels'

type Part = UIMessage['parts'][number]
type ToolCall = Extract<Part, { type: 'tool-call' }>
type ToolResult = Extract<Part, { type: 'tool-result' }>

type StepState = 'running' | 'done' | 'error'

function stepState(call: ToolCall, result: ToolResult | undefined): StepState {
  if (call.state === 'error' || result?.state === 'error') return 'error'
  const output = call.output ?? (result ? parseJson(result.content) : undefined)
  if (output === undefined) return 'running'
  return output && typeof output === 'object' && 'ok' in output && output.ok === false ? 'error' : 'done'
}

function parseJson(content: ToolResult['content']): unknown {
  if (typeof content !== 'string') return content
  try {
    return JSON.parse(content)
  } catch {
    return content
  }
}

function pretty(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function Step({ call, result }: { call: ToolCall; result: ToolResult | undefined }) {
  const state = stepState(call, result)
  const output = call.output ?? (result ? (result.error ?? parseJson(result.content)) : undefined)
  return (
    <li className="assistant-step" data-state={state}>
      <details>
        <summary>
          <span className="assistant-step__glyph" aria-hidden="true">
            {state === 'running' ? (
              <span className="assistant-spinner" />
            ) : state === 'done' ? (
              <CheckmarkFilled size={16} />
            ) : (
              <ErrorFilled size={16} />
            )}
          </span>
          <span className="assistant-step__label">{stepLabel(call.name, call.input)}</span>
          <span className="assistant-sr-only">{state === 'running' ? ' (running)' : state === 'error' ? ' (failed)' : ' (done)'}</span>
          <ChevronRight size={16} className="assistant-chevron" aria-hidden="true" />
        </summary>
        <div className="assistant-step__detail">
          <p>Input</p>
          <pre>{pretty(call.input ?? call.arguments)}</pre>
          {output !== undefined && (
            <>
              <p>Result</p>
              <pre>{pretty(output)}</pre>
            </>
          )}
        </div>
      </details>
    </li>
  )
}

type Block =
  | { kind: 'thinking'; text: string }
  | { kind: 'steps'; calls: ToolCall[] }
  | { kind: 'text'; text: string }

/** Thinking collapses into one row, consecutive tool calls into one step list, text into paragraphs; in part order. */
function blocks(parts: Part[]): Block[] {
  const out: Block[] = []
  for (const part of parts) {
    const last = out.at(-1)
    if (part.type === 'thinking') {
      const thinking = out.find((b): b is Extract<Block, { kind: 'thinking' }> => b.kind === 'thinking')
      if (thinking) thinking.text += `\n\n${part.content}`
      else out.unshift({ kind: 'thinking', text: part.content })
    } else if (part.type === 'tool-call') {
      if (last?.kind === 'steps') last.calls.push(part)
      else out.push({ kind: 'steps', calls: [part] })
    } else if (part.type === 'text' && part.content.trim()) {
      if (last?.kind === 'text') last.text += part.content
      else out.push({ kind: 'text', text: part.content })
    }
  }
  return out
}

export function AssistantMessage({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.content : '')).join('')
    return <li className="assistant-msg assistant-msg--user">{text}</li>
  }
  if (message.role !== 'assistant') return null
  const results = new Map<string, ToolResult>()
  for (const p of message.parts) if (p.type === 'tool-result') results.set(p.toolCallId, p)
  const list = blocks(message.parts)
  return (
    <li className="assistant-msg assistant-msg--assistant">
      {list.length === 0 && streaming && <p className="assistant-pending">…</p>}
      {list.map((block, i) => {
        if (block.kind === 'thinking') {
          return (
            <details key={i} className="assistant-thinking">
              <summary>
                <ChevronRight size={16} className="assistant-chevron" aria-hidden="true" />
                {streaming ? 'Thinking…' : 'Thinking'}
              </summary>
              <p className="assistant-thinking__body">{block.text.trim()}</p>
            </details>
          )
        }
        if (block.kind === 'steps') {
          return (
            <ol key={i} className="assistant-steps" aria-label="Actions">
              {block.calls.map((call) => (
                <Step key={call.id} call={call} result={results.get(call.id)} />
              ))}
            </ol>
          )
        }
        return block.text
          .split(/\n{2,}/)
          .filter((p) => p.trim())
          .map((paragraph, j) => (
            <p key={`${i}-${j}`} className="assistant-text">
              {paragraph}
            </p>
          ))
      })}
    </li>
  )
}
