import '@tanstack/react-start/server-only'

import { betterAuth } from 'better-auth'
import { env, waitUntil } from 'cloudflare:workers'

const FROM = { email: 'no-reply@noahos.adamgoodapp.com', name: 'NoahOS' }

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Sends an activation or reset email after the response (waitUntil); failures are logged, never surfaced to the caller. */
function sendAuthEmail(kind: 'verify' | 'reset', to: string, name: string, url: string): void {
  const subject = kind === 'verify' ? 'Verify your NoahOS email' : 'Reset your NoahOS password'
  const lead =
    kind === 'verify'
      ? 'Confirm your email address to activate your NoahOS account.'
      : 'Set a new password for your NoahOS account.'
  const tail =
    kind === 'verify'
      ? "This link expires in 1 hour. If you didn't create an account, ignore this email."
      : "This link expires in 1 hour. If you didn't ask to reset your password, ignore this email; your password stays the same."
  const action = kind === 'verify' ? 'Verify email' : 'Set new password'
  const text = `Hi ${name},\n\n${lead}\n${url}\n\n${tail}\n\nNoahOS`
  const safe = (s: string) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!)
  const html = `<p>Hi ${safe(name)},</p><p>${lead}</p><p><a href="${safe(url)}">${action}</a></p><p>${tail}</p><p>NoahOS</p>`

  if (env.APP_ENV !== 'production') console.log(JSON.stringify({ event: 'auth-email', kind, to, url }))
  // No binding in this runtime (never the case in production).
  if (!env.EMAIL) {
    console.log(JSON.stringify({ event: 'auth-email-skipped', kind, to }))
    return
  }
  waitUntil(
    env.EMAIL.send({ from: FROM, to, subject, text, html })
      .then((r) => console.log(JSON.stringify({ event: 'auth-email-sent', kind, to, messageId: r.messageId })))
      .catch((e: unknown) => console.log(JSON.stringify({ event: 'auth-email-failed', kind, to, error: String(e) }))),
  )
}

function createAuth() {
  return betterAuth({
    appName: 'NoahOS',
    baseURL: env.APP_ORIGIN || undefined,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, url }) => sendAuthEmail('reset', user.email, user.name, url),
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => sendAuthEmail('verify', user.email, user.name, url),
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 3600,
    },
    session: { cookieCache: { enabled: true, maxAge: 300 } },
  })
}

// Module-private: the instance type is whatever betterAuth infers from these options (its plugin/session typing).
let auth: ReturnType<typeof createAuth> | undefined
/** Lazy singleton: bindings are read at request time, not at module evaluation. */
export function getAuth() {
  return (auth ??= createAuth())
}
