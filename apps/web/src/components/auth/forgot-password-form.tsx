import { Button, Form, InlineNotification, Stack, TextInput } from '@carbon/react'
import { Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { authClient } from '@/lib/auth-client'

import { AuthShell } from './auth-shell'
import { useSubmitGate } from './use-submit-gate'

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const { pending, disabled, run } = useSubmitGate()
  const [sent, setSent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    // Same confirmation whatever the result, so the page does not reveal which addresses have accounts.
    await run(() => authClient.requestPasswordReset({ email, redirectTo: '/auth/reset-password' }))
    setSent(true)
  }

  const footer = (
    <Link to="/auth/sign-in" className="cds--link">
      Back to sign in
    </Link>
  )

  return (
    <AuthShell
      title="Reset your password"
      lead={sent ? undefined : "Enter your email and we'll send you a link to set a new password."}
      footer={footer}
    >
      {sent ? (
        <InlineNotification
          kind="info"
          title="Check your email."
          subtitle={`If an account exists for ${email}, we sent a reset link. It expires in 1 hour.`}
          lowContrast
          hideCloseButton
          role="status"
        />
      ) : (
        <Form className="auth-form" onSubmit={submit}>
          <Stack gap={6}>
            <TextInput
              id="forgot-email"
              type="email"
              size="lg"
              labelText="Email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="submit" size="lg" disabled={disabled}>
              {pending ? 'Sending…' : 'Send reset link'}
            </Button>
          </Stack>
        </Form>
      )}
    </AuthShell>
  )
}
