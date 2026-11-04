import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'

import { getAuth } from './auth.server'

export type SessionUser = { id: string; name: string; email: string }

/** The signed-in user for the current request, or null. Only these three fields reach the client. */
export const getSessionUser = createServerFn({ method: 'GET' }).handler(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: getRequest().headers })
  return session ? { id: session.user.id, name: session.user.name, email: session.user.email } : null
})
