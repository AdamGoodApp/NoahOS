import { Button, Form, InlineNotification, PasswordInput, Stack, TextInput } from '@carbon/react'
import { Link } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { authClient } from '@/lib/auth-client'

import { AuthShell } from './auth-shell'
import { useSubmitGate } from './use-submit-gate'

const VERIFIED_URL = '/auth/sign-in?verified=1'

export function SignUpForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)
  const { pending, disabled, run } = useSubmitGate()
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [resent, setResent] = useState(false)
  const tooShort = password.length < 8

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (tooShort) return
    const { error } = await run(() => authClient.signUp.email({ name, email, password, callbackURL: VERIFIED_URL }))
    if (error) setError(error.message ?? 'Could not create the account. Try again.')
    else setSent(true)
  }

  async function resend() {
    await run(() => authClient.sendVerificationEmail({ email, callbackURL: VERIFIED_URL }))
    setResent(true)
  }

  const footer = (
    <>
      Already have an account?{' '}
      <Link to="/auth/sign-in" className="cds--link">
        Sign in
      </Link>
    </>
  )

  // Also shown for an address that already has an account: the server does not reveal which addresses exist.
  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        lead={`We sent an activation link to ${email}. Open it to finish creating your account. The link expires in 1 hour.`}
        footer={footer}
      >
        {resent && <InlineNotification kind="success" title="Link sent." lowContrast hideCloseButton role="status" />}
        <Button kind="tertiary" size="lg" disabled={disabled} onClick={resend}>
          Resend link
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your NoahOS account"
      lead="Email and password only. We'll send you a link to activate the account."
      footer={footer}
    >
      {error && <InlineNotification kind="error" title="Account not created." subtitle={error} lowContrast hideCloseButton role="alert" />}
      <Form className="auth-form" onSubmit={submit}>
        <Stack gap={6}>
          <TextInput
            id="sign-up-name"
            size="lg"
            labelText="Name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextInput
            id="sign-up-email"
            type="email"
            size="lg"
            labelText="Email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <PasswordInput
            id="sign-up-password"
            size="lg"
            labelText="Password"
            autoComplete="new-password"
            helperText="At least 8 characters"
            required
            invalid={touched && tooShort}
            invalidText="Use at least 8 characters."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" size="lg" disabled={disabled}>
            {pending ? 'Creating account…' : 'Create account'}
          </Button>
        </Stack>
      </Form>
    </AuthShell>
  )
}
