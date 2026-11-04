import { execSync } from 'node:child_process'
import { expect, test as setup } from '@playwright/test'

import { E2E_USER, STATE } from './auth-state'

setup('sign in as the e2e operator', async ({ request, baseURL }) => {
  const headers = { origin: baseURL! } // better-auth's origin check expects a browser-like request
  // First run creates the user; later runs get the same synthetic success (better-auth hides existing addresses).
  await request.post('/api/auth/sign-up/email', { data: E2E_USER, headers })
  // Local D1 (.wrangler/state/v3, shared by vite dev and wrangler): mark the address verified; no email is read.
  execSync(
    `pnpm exec wrangler d1 execute noahos-auth --local --config wrangler.jsonc --command "UPDATE user SET emailVerified = 1 WHERE email = '${E2E_USER.email}'"`,
    { stdio: 'inherit' },
  )
  const r = await request.post('/api/auth/sign-in/email', { data: { email: E2E_USER.email, password: E2E_USER.password }, headers })
  expect(r.ok()).toBe(true)
  await request.storageState({ path: STATE })
})
