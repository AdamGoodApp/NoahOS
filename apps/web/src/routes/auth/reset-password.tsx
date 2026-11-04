import { createFileRoute } from '@tanstack/react-router'

import { ResetPasswordForm, type ResetPasswordSearch } from '@/components/auth/reset-password-form'

export const Route = createFileRoute('/auth/reset-password')({
  // `token` from the emailed link; `error=INVALID_TOKEN` when the link was used or expired.
  validateSearch: (s: Record<string, unknown>): ResetPasswordSearch => ({
    token: typeof s.token === 'string' ? s.token : undefined,
    error: typeof s.error === 'string' ? s.error : undefined,
  }),
  head: () => ({ meta: [{ title: 'Set a new password · NoahOS' }] }),
  component: () => <ResetPasswordForm search={Route.useSearch()} />,
})
