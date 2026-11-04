import { Button, Form, InlineNotification, PasswordInput, Stack } from '@carbon/react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { authClient } from '@/lib/auth-client'

import { AuthShell } from './auth-shell'
import { useSubmitGate } from './use-submit-gate'

export type ResetPasswordSearch = { token?: string; error?: string }

export function ResetPasswordForm({ search }: { search: ResetPasswordSearch }) {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [touched, setTouched] = useState(false)
  const { pending, disabled, run } = useSubmitGate()
  const [error, setError] = useState<string | null>(null)
  const tooShort = password.length < 8
  const mismatch = password !== confirm
  const { token } = search

  if (search.error || !token) {
    return (
      <AuthShell
        title="Set a new password"
        footer={
          <Link to="/auth/forgot-password" className="cds--link">
            Request a new link
          </Link>
        }
      >
        <InlineNotification kind="error" title="This reset link is invalid or has expired." lowContrast hideCloseButton role="alert" />
      </AuthShell>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (tooShort || mismatch) return
    const { error } = await run(() => authClient.resetPassword({ newPassword: password, token }))
    if (error) setError(error.message ?? 'Could not set the password. Try again.')
    else navigate({ href: '/auth/sign-in?reset=1' }) // plain `1`, matching the links better-auth builds (`verified=1`)
  }

  return (
    <AuthShell title="Set a new password">
      {error && <InlineNotification kind="error" title="Password not updated." subtitle={error} lowContrast hideCloseButton role="alert" />}
      <Form className="auth-form" onSubmit={submit}>
        <Stack gap={6}>
          <PasswordInput
            id="reset-password"
            size="lg"
            labelText="New password"
            autoComplete="new-password"
            helperText="At least 8 characters"
            required
            invalid={touched && tooShort}
            invalidText="Use at least 8 characters."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <PasswordInput
            id="reset-password-confirm"
            size="lg"
            labelText="Confirm new password"
            autoComplete="new-password"
            required
            invalid={touched && !tooShort && mismatch}
            invalidText="Passwords don't match."
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <Button type="submit" size="lg" disabled={disabled}>
            {pending ? 'Saving…' : 'Set new password'}
          </Button>
        </Stack>
      </Form>
    </AuthShell>
  )
}
