import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { chat, chatParamsFromRequest, maxIterations, toServerSentEventsResponse } from '@tanstack/ai'

import { describePage } from '@/lib/agent/page-context'
import { TOOL_DEFINITIONS } from '@/lib/agent/tools'
import { getAuth } from '@/server/auth.server'
import {
  ASSISTANT_REASONING,
  SYSTEM_PROMPT,
  assistantAvailable,
  createAssistantAdapter,
} from '@/server/assistant.server'

/** Assistant chat: AG-UI request in, SSE stream out. Tools have no server execute: the browser runs them. */
export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      // Availability probe for the panel (no session needed; nothing secret).
      GET: () => Response.json({ available: assistantAvailable() }),
      POST: async ({ request }) => {
        const session = await getAuth().api.getSession({ headers: request.headers })
        if (!session) return Response.json({ error: 'Sign in to use the assistant.' }, { status: 401 })
        if (!assistantAvailable()) {
          return Response.json({ error: 'The assistant runs on the live site only.' }, { status: 503 })
        }
        const params = await chatParamsFromRequest(request)
        // A new user message counts against the message cap; continuations after browser tool results only against
        // the step cap, so a run already moving a robot can still finish and report.
        const newTurn = params.messages.at(-1)?.role === 'user'
        const limits = newTurn ? [env.CHAT_LIMIT, env.CHAT_STEP_LIMIT] : [env.CHAT_STEP_LIMIT]
        for (const limit of limits) {
          if (!(await limit.limit({ key: session.user.id })).success) {
            return Response.json({ error: 'Too many messages. Wait a minute, then try again.' }, { status: 429 })
          }
        }
        const abortController = new AbortController()
        const stream = chat({
          adapter: createAssistantAdapter(),
          systemPrompts: [
            SYSTEM_PROMPT,
            describePage(params.forwardedProps),
            `The user is signed in as ${session.user.name}.`,
          ],
          messages: params.messages,
          threadId: params.threadId,
          runId: params.runId,
          parentRunId: params.parentRunId,
          ...(params.resume ? { resume: params.resume } : {}),
          tools: TOOL_DEFINITIONS,
          reasoning: ASSISTANT_REASONING,
          agentLoopStrategy: maxIterations(8),
          abortController,
        })
        return toServerSentEventsResponse(stream, { abortController })
      },
    },
  },
})
