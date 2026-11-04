import { defineConfig, devices } from '@playwright/test'

import { STATE } from './e2e/auth-state'

// E2E smoke against a running sim (docker compose in apps/sim, or SIM_UPSTREAM) and `vite dev`.
// Chromium and WebKit (Safari's engine) both run, per STACK.md §10 Phase 2.
const port = Number(process.env.E2E_PORT ?? 3100)

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 } },
  // `setup` signs in once; the browser projects start every context with that session (/app requires it).
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, storageState: STATE },
      dependencies: ['setup'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, storageState: STATE },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `pnpm exec vite dev --port ${port} --strictPort`,
    url: `http://localhost:${port}/app`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
