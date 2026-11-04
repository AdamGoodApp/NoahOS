import { createFileRoute } from '@tanstack/react-router'

import { getAuth } from '@/server/auth.server'

/** better-auth endpoints (/api/auth/sign-in/email, /api/auth/verify-email, …). */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => getAuth().handler(request),
      POST: ({ request }) => getAuth().handler(request),
    },
  },
})
