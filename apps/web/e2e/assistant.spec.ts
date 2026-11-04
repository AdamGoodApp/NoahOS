import { expect, test, type Page } from '@playwright/test'

// The assistant's tools, run through a WebMCP stand-in (no model needed): proves every tool drives the real UI.
// Needs a running sim (apps/sim: `docker compose up`) reachable through SIM_UPSTREAM in .dev.vars.
const ROBOT = '/app/robots/franka_fr3'
const TOOL_COUNT = 19

type ToolResult = { ok: boolean; reason?: string; [key: string]: unknown }

declare global {
  interface Window {
    __mcp: () => string[]
    __run: (name: string, input: unknown) => Promise<string>
  }
}

test.skip(({ browserName }) => browserName !== 'chromium', 'one browser is enough for the tool layer')

test.beforeEach(async ({ page }) => {
  // Installed before any page script, so TanStack's registerWebMCPTools finds `document.modelContext`.
  await page.addInitScript(() => {
    type Registered = { name: string; execute: (input: unknown, options: { signal: AbortSignal }) => Promise<unknown> }
    const tools: Record<string, Registered> = {}
    Object.defineProperty(document, 'modelContext', {
      value: {
        registerTool(tool: Registered, options?: { signal?: AbortSignal }) {
          tools[tool.name] = tool
          options?.signal?.addEventListener('abort', () => {
            if (tools[tool.name] === tool) delete tools[tool.name]
          })
          return Promise.resolve()
        },
      },
    })
    window.__mcp = () => Object.keys(tools)
    window.__run = (name, input) => {
      const tool = tools[name]
      if (!tool) return Promise.reject(new Error(`no tool ${name}`))
      return tool.execute(input, { signal: new AbortController().signal }).then((r) => JSON.stringify(r))
    }
  })
})

async function run(page: Page, name: string, input: unknown = {}): Promise<ToolResult> {
  return JSON.parse(await page.evaluate(([n, i]) => window.__run(n as string, i), [name, input] as const)) as ToolResult
}

test('assistant tools drive the Control page, live view and the fleet', async ({ page }) => {
  await page.goto(ROBOT)
  await expect.poll(() => page.evaluate(() => window.__mcp().length)).toBe(TOOL_COUNT)

  // Model and joints.
  const model = await run(page, 'get_robot_model')
  expect(model.ok).toBe(true)
  const joints = model.joints as { name: string; type: string; range: [number, number] | null }[]
  expect(joints.length).toBeGreaterThan(0)
  const hinge = joints.find((j) => j.type === 'hinge')!
  const expected = hinge.range ? Math.min(hinge.range[1], Math.max(hinge.range[0], 10)) : 10
  const set = await run(page, 'set_joints', { joints: [{ name: hinge.name, value: 10 }] })
  expect(set.ok).toBe(true)
  expect((set.applied as { value: number }[])[0]!.value).toBeCloseTo(expected, 1)
  const after = await run(page, 'get_robot_model')
  expect((after.joints as { name: string; value: number }[]).find((j) => j.name === hinge.name)!.value).toBeCloseTo(expected, 1)
  const undone = await run(page, 'undo_edit')
  expect(undone).toMatchObject({ ok: true, undone: 1 })

  // Unknown joints and robots come back as reasons, not exceptions.
  expect(await run(page, 'set_joints', { joints: [{ name: 'tail', value: 1 }] })).toMatchObject({ ok: false })
  expect(await run(page, 'get_robot_model', { robotId: 'nope' })).toMatchObject({ ok: false, reason: 'Unknown robot id "nope". Use list_robots.' })

  // View and tabs.
  const view = await run(page, 'set_view', { preset: 'front', zoomPercent: 150 })
  expect(view.ok).toBe(true)
  await expect(page.locator('#control-view')).toContainText('View: Front')
  await expect(page.locator('#control-zoom')).toContainText('Zoom: 150%')
  expect(await run(page, 'open_tab', { tab: 'simulation' })).toMatchObject({ ok: true })
  await expect(page.getByRole('tab', { name: 'Simulation' })).toHaveAttribute('aria-selected', 'true')
  await run(page, 'open_tab', { tab: 'control' })

  // Live view and a policy.
  expect(await run(page, 'run_policy', { action: 'play', policy: 'Joint sweep' })).toMatchObject({
    ok: false,
    reason: 'Start Live view first (live_view start).',
  })
  const live = await run(page, 'live_view', { action: 'start' })
  expect(live).toMatchObject({ ok: true, status: 'live', role: 'operator' })
  await expect(page.getByText('Operator · ')).toBeVisible()
  expect(await run(page, 'run_policy', { action: 'play', policy: 'joint sweep' })).toMatchObject({ ok: true, mode: 'auto' })
  await expect(page.getByText(/Operator · Playing/)).toBeVisible()
  expect(await run(page, 'set_joints', { joints: [{ name: hinge.name, value: 5 }] })).toMatchObject({ ok: false })
  expect(await run(page, 'run_policy', { action: 'pause' })).toMatchObject({ ok: true, mode: 'manual' })
  const status = await run(page, 'get_live_status')
  expect(status).toMatchObject({ ok: true, status: 'live', mode: 'manual', role: 'operator' })
  expect(await run(page, 'live_view', { action: 'stop' })).toMatchObject({ ok: true })
  await expect(page.getByRole('button', { name: 'Live view', exact: true })).toBeVisible()

  // Fleet: navigates and filters.
  expect(await run(page, 'navigate', { to: 'fleet' })).toMatchObject({ ok: true, page: 'fleet' })
  await expect(page).toHaveURL(/\/app\/?$/)
  const fleet = await run(page, 'filter_fleet', { status: 'fault' })
  expect(fleet.ok).toBe(true)
  expect((fleet.visible as unknown[]).length).toBe((fleet.counts as Record<string, number>).fault)
  await expect(page.getByRole('radio', { name: /^Fault/ }).first()).toBeChecked()
  expect(await run(page, 'filter_fleet', { clear: true })).toMatchObject({ ok: true, status: 'all' })

  // Opening a robot from elsewhere waits for its model.
  const g1 = await run(page, 'get_robot_model', { robotId: 'unitree_g1' })
  expect(g1).toMatchObject({ ok: true, robotId: 'unitree_g1' })
  await expect(page).toHaveURL(/\/app\/robots\/unitree_g1$/)

  // Robot to robot: the tools wait for the new model, never answer with the previous robot's joints.
  const g1Joints = (g1.joints as { name: string }[]).map((j) => j.name)
  const fr3 = await run(page, 'get_robot_model', { robotId: 'franka_fr3' })
  expect(fr3).toMatchObject({ ok: true, robotId: 'franka_fr3' })
  const fr3Joints = (fr3.joints as { name: string }[]).map((j) => j.name)
  expect(fr3Joints).toEqual(joints.map((j) => j.name))
  expect(fr3Joints).not.toEqual(g1Joints)
  const back = await run(page, 'get_robot_model', { robotId: 'unitree_g1' })
  expect((back.joints as { name: string }[]).map((j) => j.name)).toEqual(g1Joints)
})

test('assistant panel opens from the header; the chat API needs a session and the live site', async ({ page, browser, baseURL }) => {
  await page.goto('/app')
  // Tools register after hydration; a click before that is lost.
  await expect.poll(() => page.evaluate(() => window.__mcp().length)).toBe(TOOL_COUNT)
  await page.getByRole('button', { name: 'Assistant' }).click()
  const panel = page.getByRole('complementary', { name: 'Assistant' })
  await expect(panel).toHaveAttribute('data-open', 'true')
  for (const tab of ['Fleet', 'Control', 'Simulation']) await expect(panel.getByRole('tab', { name: tab })).toBeVisible()
  await expect(panel.getByText('The assistant runs on the live site only.')).toBeVisible()
  await expect(panel.getByRole('textbox', { name: 'Message' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.locator('aside.assistant-panel')).toHaveAttribute('data-open', 'false')

  expect((await page.request.post('/api/chat', { data: {} })).status()).toBe(503)
  const anonymous = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  expect((await anonymous.request.post('/api/chat', { data: {} })).status()).toBe(401)
  await anonymous.close()
})
