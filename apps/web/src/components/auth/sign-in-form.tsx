import { Button, Form, InlineNotification, PasswordInput, Stack, TextInput } from '@carbon/react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'

import { authClient } from '@/lib/auth-client'

import { AuthShell } from './auth-shell'
import { useSubmitGate } from './use-submit-gate'

export type SignInSearch = { redirect?: string; verified?: '1'; error?: string; reset?: '1' }
type Notice = { kind: 'error' | 'success' | 'info'; title: string; subtitle?: string }

/**
 * Where to go after signing in: the same-origin path from `?redirect=`, else the dashboard.
 * Parsed as a URL rather than pattern-matched: browsers strip TAB/CR/LF, so `/\t/evil.com` would become `//evil.com`.
 */
export function signInTarget(redirect: string | undefined): string {
  if (!redirect) return '/app'
  try {
    const u = new URL(redirect, 'https://x.invalid')
    return u.origin === 'https://x.invalid' ? u.pathname + u.search + u.hash : '/app'
  } catch {
    return '/app'
  }
}

/** Status carried in the URL by the verification and reset links (first match wins). */
function searchNotice(search: SignInSearch): Notice | null {
  if (search.error) return { kind: 'error', title: 'This link is invalid or has expired.', subtitle: 'Sign in to get a new activation link.' }
  if (search.reset) return { kind: 'success', title: 'Password updated.', subtitle: 'Sign in with your new password.' }
  if (search.verified) return { kind: 'success', title: 'Email verified.', subtitle: 'Sign in to continue.' }
  return null
}

export function SignInForm({ search }: { search: SignInSearch }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { pending, disabled, run } = useSubmitGate()
  const [notice, setNotice] = useState<Notice | null>(() => searchNotice(search))

  async function submit(e: FormEvent) {
    e.preventDefault()
    const target = signInTarget(search.redirect)
    // An unverified account gets a fresh activation link that signs in and returns here (then on to `target`).
    const callbackURL = `/auth/sign-in?verified=1&redirect=${encodeURIComponent(target)}`
    const { error } = await run(() => authClient.signIn.email({ email, password, callbackURL }))
    if (!error) {
      navigate({ href: target })
      return
    }
    if (error.status === 403) {
      setNotice({ kind: 'info', title: 'Verify your email first.', subtitle: `We sent a new activation link to ${email}.` })
    } else if (error.status === 401) {
      setNotice({ kind: 'error', title: 'Email or password is incorrect.' })
    } else {
      setNotice({ kind: 'error', title: 'Sign in failed.', subtitle: error.message ?? 'Try again in a moment.' })
    }
  }

  return (
    <AuthShell
      title="Sign in to NoahOS"
      lead="Use the email and password you signed up with."
      footer={
        <>
          New to NoahOS?{' '}
          <Link to="/auth/sign-up" className="cds--link">
            Create an account
          </Link>
        </>
      }
    >
      {notice && (
        <InlineNotification
          kind={notice.kind}
          title={notice.title}
          subtitle={notice.subtitle}
          lowContrast
          hideCloseButton
          role={notice.kind === 'error' ? 'alert' : 'status'}
        />
      )}
      <Form className="auth-form" onSubmit={submit}>
        <Stack gap={6}>
          <TextInput
            id="sign-in-email"
            type="email"
            size="lg"
            labelText="Email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <div>
            <PasswordInput
              id="sign-in-password"
              size="lg"
              labelText="Password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <div className="auth-row">
              <Link to="/auth/forgot-password" className="cds--link">
                Forgot password?
              </Link>
            </div>
          </div>
          <Button type="submit" size="lg" disabled={disabled}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </Stack>
      </Form>
    </AuthShell>
  )
}
