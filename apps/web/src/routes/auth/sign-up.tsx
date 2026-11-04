import { createFileRoute, redirect } from '@tanstack/react-router'

import { SignUpForm } from '@/components/auth/sign-up-form'
import { getSessionUser } from '@/server/auth.functions'

export const Route = createFileRoute('/auth/sign-up')({
  beforeLoad: async () => {
    if (await getSessionUser()) throw redirect({ to: '/app' })
  },
  head: () => ({ meta: [{ title: 'Create account · NoahOS' }] }),
  component: SignUpForm,
})
