import { createAuthClient } from 'better-auth/react'

/** Same-origin client (no baseURL): /api/auth on whatever host served the page. */
export const authClient = createAuthClient()
