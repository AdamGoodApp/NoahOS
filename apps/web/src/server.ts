import handler, { createServerEntry } from '@tanstack/react-start/server-entry'
import { env } from 'cloudflare:workers'

import { FLEET } from './components/app/fleet-data'
import { getAuth } from './server/auth.server'

// The Durable Object class must be exported from the Worker entry for the binding in wrangler.jsonc.
export { RobotSession } from './server/robot-session'

const LIVE_ROUTE = /^\/(?:ws|api\/live)\/robots\/([^/]+)/
const ROBOT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const USER_HEADER = 'x-noahos-user'

export default createServerEntry({
  async fetch(request, opts) {
    const url = new URL(request.url)
    // The fleet with each robot's USDZ twin, for the visionOS app (files from `pnpm models:usdz`).
    if (url.pathname === '/api/robots') {
      return Response.json(
        FLEET.map(({ id, name, category }) => ({ id, name, category, usdz: `/models/usdz/${id}.usdz`, twin: `/models/usdz/${id}.json` })),
      )
    }
    const m = url.pathname.match(LIVE_ROUTE)
    if (!m) return handler.fetch(request, opts)

    const robotId = decodeURIComponent(m[1]!)
    if (!ROBOT_ID.test(robotId)) return new Response('Not found', { status: 404 })

    // Production: the browser's session cookie identifies the operator.
    // Locally the relay stays open for the visionOS app and the protocol-level e2e tests.
    const production = env.APP_ENV === 'production'
    const session = await getAuth()
      .api.getSession({ headers: request.headers })
      .catch((e: unknown) => {
        if (production) throw e
        return null // local D1 not migrated yet: keep the relay usable
      })
    if (production && !session) return new Response('Unauthorized', { status: 401 })

    // The relay trusts this header, so it is always overwritten here and never taken from the client.
    const headers = new Headers(request.headers)
    headers.delete(USER_HEADER)
    if (session) headers.set(USER_HEADER, session.user.name || session.user.email)
    return env.ROBOT_SESSION.getByName(robotId).fetch(new Request(request, { headers }))
  },
})
