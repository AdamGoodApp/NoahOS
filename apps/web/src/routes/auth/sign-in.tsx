import { createFileRoute, redirect } from '@tanstack/react-router'

import { SignInForm, signInTarget, type SignInSearch } from '@/components/auth/sign-in-form'
import { getSessionUser } from '@/server/auth.functions'

export const Route = createFileRoute('/auth/sign-in')({
  // `redirect`: page to return to; `verified`/`error`: from the activation link; `reset`: after a password reset.
  validateSearch: (s: Record<string, unknown>): SignInSearch => ({
    redirect: typeof s.redirect === 'string' ? s.redirect : undefined,
    verified: s.verified === '1' || s.verified === 1 ? '1' : undefined,
    error: typeof s.error === 'string' ? s.error : undefined,
    reset: s.reset === '1' || s.reset === 1 ? '1' : undefined,
  }),
  // Already signed in (including straight after an activation link): continue to the requested page.
  beforeLoad: async ({ search }) => {
    if (await getSessionUser()) throw redirect({ href: signInTarget(search.redirect) })
  },
  head: () => ({ meta: [{ title: 'Sign in · NoahOS' }] }),
  component: () => <SignInForm search={Route.useSearch()} />,
})
