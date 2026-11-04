import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import { createAnthropicChat } from '@tanstack/ai-anthropic'

import { FLEET } from '@/components/app/fleet-data'

/** Anthropic's model id (what the TanStack adapter knows) and the AI Gateway catalog id (what the binding takes). */
export const ASSISTANT_MODEL = 'claude-haiku-5-5'
const CATALOG_MODEL = 'anthropic/claude-haiku-5.5'
const GATEWAY_ID = 'main'
// Adaptive thinking: at `medium` Haiku skips thinking on simple requests, so the panel would show no thought process.
export const ASSISTANT_REASONING = 'high' as const

/** Production only: locally the panel shows "runs on the live site only" and POST answers 503. */
export function assistantAvailable(): boolean {
  return env.APP_ENV === 'production'
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ type: 'error', error: { type: 'api_error', message } }, { status })
}

/**
 * The Anthropic SDK's Messages request, sent through the Worker's AI binding to AI Gateway `main` instead of over
 * HTTP. The binding is authenticated by the account, and the gateway supplies its stored (BYOK, `default` alias)
 * Anthropic key, so the Worker holds no credential. The SDK still parses Anthropic's own JSON / SSE response.
 */
const bindingFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  if (request.method !== 'POST' || !new URL(request.url).pathname.endsWith('/v1/messages')) {
    return errorResponse(404, `Unsupported assistant request: ${request.method} ${new URL(request.url).pathname}`)
  }
  const { model: _model, ...body } = (await request.json()) as Record<string, unknown>
  try {
    const result: unknown = await env.AI.run(CATALOG_MODEL, body, {
      gateway: { id: GATEWAY_ID },
      returnRawResponse: true,
      signal: request.signal,
    })
    if (result instanceof Response) return result
    if (result instanceof ReadableStream) return new Response(result, { headers: { 'content-type': 'text/event-stream' } })
    return Response.json(result)
  } catch (error) {
    console.log(JSON.stringify({ event: 'assistant-gateway-error', error: String(error) }))
    return errorResponse(502, error instanceof Error ? error.message : String(error))
  }
}

export function createAssistantAdapter() {
  // The credential and base URL are placeholders: `bindingFetch` never sends them anywhere.
  return createAnthropicChat(ASSISTANT_MODEL, 'ai-gateway-binding', {
    baseURL: 'https://ai-gateway.binding',
    fetch: bindingFetch,
    maxRetries: 0,
  })
}

const FLEET_LINES = FLEET.map((r) => `${r.id} — ${r.name} (${r.category}, ${r.site}, ${r.status})`).join('\n')

export const SYSTEM_PROMPT = `You are the NoahOS assistant inside the NoahOS web console, an operating console for a fleet of simulated robots (MuJoCo). You act by calling tools; the tools run in the user's browser and change what they see.
Pages: the fleet dashboard (/app) and one Control page per robot (/app/robots/<id>) with a 3D twin, joint control, Live view (a physics sim with telemetry, cameras and policies), Simulation and Logs tabs.
Rules:
- Prefer tools over guessing. To learn a robot's joints or state call get_robot_model / get_live_status first; joint names must come from get_robot_model.
- Tools that need a page open it for you (they navigate and wait). Say what you did in one short sentence; never claim an action you did not perform. When a tool returns ok:false, explain the reason and the next step.
- Joint values: degrees for hinge joints and metres for slide joints unless the user says radians. Values are clamped to the joint range; tell the user when that happens.
- Live view starts a simulation container and takes a few seconds. Playing a policy needs the operator role and Manual mode; Stop is an emergency stop that freezes the robot.
- Answer in plain text (no markdown), at most a few sentences, sentence case. Use the robot's display name.
Fleet (id — name):
${FLEET_LINES}`
