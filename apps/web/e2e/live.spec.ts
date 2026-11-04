import { execSync } from 'node:child_process'
import { create, fromBinary, toBinary, type MessageInitShape } from '@bufbuild/protobuf'
import { expect, test, type Page } from '@playwright/test'

import {
  ClientMessageSchema,
  EventKind,
  Mode,
  Role,
  ServerMessageSchema,
  type ServerMessage,
} from '../src/gen/noahos/sim/v1/sim_pb'
import { STATE } from './auth-state'

// Needs a running sim (apps/sim: `docker compose up`) reachable through SIM_UPSTREAM in .dev.vars.
const ROBOT = '/app/robots/franka_fr3'

/** Clicks Live view until the page is hydrated and live (the first click can land before hydration). */
async function goLive(page: Page, role: 'Operator' | 'Viewer') {
  const tag = page.getByText(`${role} · `)
  for (let i = 0; i < 20 && !(await tag.isVisible()); i++) {
    const button = page.getByRole('button', { name: 'Live view', exact: true })
    if (await button.isVisible()) await button.click()
    await page.waitForTimeout(1000)
  }
  await expect(tag).toBeVisible()
}

const hz = async (page: Page) => Number((await page.locator('.live-tags').innerText()).match(/(\d+) Hz/)?.[1] ?? 0)

const DEG = 180 / Math.PI
const pad = (page: Page) => page.getByRole('slider', { name: /control pad$/ })

/** Clicks around the middle of the uncovered 3D view (above the live dock) until a part with a movable joint is selected. */
async function selectPart(page: Page) {
  const canvas = (await page.locator('#control-stage canvas').boundingBox())!
  const dockRegion = page.getByRole('region', { name: 'Live telemetry and analysis' })
  const dock = (await dockRegion.count()) ? await dockRegion.boundingBox() : null
  const bottom = dock ? Math.min(dock.y, canvas.y + canvas.height) : canvas.y + canvas.height
  const [cx, cy] = [canvas.x + canvas.width / 2, (canvas.y + bottom) / 2]
  for (const dy of [0, -30, 30, -60, 60, -90])
    for (const dx of [0, -30, 30, -60, 60]) {
      const onCanvas = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.tagName === 'CANVAS', [cx + dx, cy + dy])
      if (!onCanvas) continue // the wheel or an overlay is there
      await page.mouse.click(cx + dx, cy + dy)
      if (await pad(page).waitFor({ timeout: 500 }).then(() => true, () => false)) return
    }
  throw new Error('no part with a movable joint under the probe clicks')
}

/** The selected joint's value on the pad, in whole degrees (the FR3's joints are hinges). */
const padValue = async (page: Page) => Math.round(Number(await pad(page).getAttribute('aria-valuenow')) * DEG)

/** The selected joint's MJCF name, from the pad's label. */
const jointName = async (page: Page) => ((await pad(page).getAttribute('aria-label')) ?? '').replace(/ control pad$/, '')

/** Turns the selected joint by n degrees with the pad's arrow keys (1° each), away from its upper limit if needed; returns the new angle in degrees, unrounded. */
async function nudge(page: Page, n: number): Promise<number> {
  const before = Number(await pad(page).getAttribute('aria-valuenow')) * DEG
  const max = Number(await pad(page).getAttribute('aria-valuemax')) * DEG
  const up = before + n <= max
  await pad(page).focus()
  for (let i = 0; i < n; i++) await page.keyboard.press(up ? 'ArrowUp' : 'ArrowDown')
  return up ? before + n : before - n
}

/** The Play button of a policy in the Control tab's Policies panel. */
const playButton = (page: Page, policy: string) =>
  page.getByRole('complementary', { name: 'Policies' }).getByRole('listitem').filter({ hasText: policy }).getByRole('button', { name: 'Play', exact: true })

function last<K extends NonNullable<ServerMessage['msg']['case']>>(messages: ServerMessage[], kind: K) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!.msg
    if (m.case === kind) return m.value as Extract<ServerMessage['msg'], { case: K }>['value']
  }
  return undefined
}

/** A raw protocol client (as the visionOS app speaks it); resolves after the first SessionInfo and telemetry frame. */
async function rawClient(baseURL: string, id: string, role: Role, pairToken = '', telemetryDivisor = 1) {
  const ws = new WebSocket(`${baseURL.replace('http', 'ws')}/ws/robots/franka_fr3?client=${id}`)
  ws.binaryType = 'arraybuffer'
  const messages: ServerMessage[] = []
  ws.onmessage = (e) => messages.push(fromBinary(ServerMessageSchema, new Uint8Array(e.data as ArrayBuffer)))
  const send = (msg: MessageInitShape<typeof ClientMessageSchema>) =>
    ws.send(toBinary(ClientMessageSchema, create(ClientMessageSchema, msg)))
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)))
  send({ msg: { case: 'hello', value: { clientId: id, role, telemetryDivisor, pairToken } } })
  await expect.poll(() => last(messages, 'session')).toBeTruthy()
  await expect.poll(() => messages.some((m) => m.msg.case === 'telemetry')).toBe(true)
  return { ws, messages, send }
}

/** Records the target array of every JointTargets the page sends over its WebSockets. */
function recordJointTargets(page: Page): string[] {
  const sent: string[] = []
  page.on('websocket', (sock) =>
    sock.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') return
      const m = fromBinary(ClientMessageSchema, new Uint8Array(payload))
      if (m.msg.case === 'jointTargets') sent.push(JSON.stringify(m.msg.value.target))
    }),
  )
  return sent
}

test('Live view holds the pose; joints locked only while a policy plays; Stop halts and leaves; handover', async ({ browser }) => {
  const a = await (await browser.newContext({ storageState: STATE })).newPage()
  await a.goto(ROBOT)
  await expect(a.getByRole('toolbar', { name: 'Stage tools' })).toBeVisible()
  await goLive(a, 'Operator')
  // Going live never starts the task: the robot holds its pose and the operator can move joints.
  await expect(a.getByText(/Operator · Manual/)).toBeVisible()
  await expect.poll(() => hz(a)).toBeGreaterThan(0)

  // Live: no stage tool bar or power budget; the live dock replaces them.
  await expect(a.getByRole('toolbar', { name: 'Stage tools' })).toHaveCount(0)
  await expect(a.getByText('Power budget')).toHaveCount(0)
  const dock = a.getByRole('region', { name: 'Live telemetry and analysis' })
  for (const title of ['Power', 'Speed (max rad/s)', 'Torque load analysis', 'Joint health', 'Cycle time', 'Daily output'])
    await expect(dock.getByText(title, { exact: true }).first()).toBeVisible()
  await expect(dock.locator('.live-card').first().locator('.live-card__value')).toHaveText(/^\d+%$/)
  // The analysis cards row can be hidden and shown again; the tiles stay.
  await a.getByRole('button', { name: 'Hide analysis cards' }).click()
  await expect(dock.getByText('Torque load analysis')).toHaveCount(0)
  await expect(dock.getByText('Power', { exact: true }).first()).toBeVisible()
  await a.getByRole('button', { name: 'Show analysis cards' }).click()
  await expect(dock.getByText('Torque load analysis')).toBeVisible()

  // Manual hold (the state Live view starts in): select a part, turn its joint with the pad; that becomes the sim's target.
  await selectPart(a)
  await expect(a.getByText('XY pad')).toBeVisible()
  const name = await jointName(a)
  const exact = await nudge(a, 10)
  await expect.poll(() => padValue(a)).toBe(Math.round(exact))
  await a.getByRole('tab', { name: 'Simulation' }).click()
  const target = a.locator('.sim-tab__joints tbody tr').filter({ has: a.getByRole('cell', { name, exact: true }) }).locator('td').last()
  // The table shows one decimal: compare with the unrounded angle, not a second rounding of it.
  await expect.poll(async () => parseFloat(await target.innerText())).toBeCloseTo(exact, 0)
  await expect(a.getByText(/Denied/)).toHaveCount(0)

  // Playing a policy (Policies panel) locks the joints; Pause appears on the playing item.
  await a.getByRole('tab', { name: 'Control' }).click()
  await playButton(a, 'Joint sweep').click()
  await expect(a.getByText(/Operator · Playing/)).toBeVisible()
  await expect(a.getByText('XY pad')).toHaveCount(0)
  await expect(a.getByText(/Locked: values come from the simulation/)).toBeVisible()
  await expect(a.getByRole('complementary', { name: 'Policies' }).getByRole('button', { name: 'Pause' })).toBeVisible()
  await a.keyboard.press('Escape')
  await expect(a.getByText('Health checks')).toBeVisible()

  // A viewer's Stop halts the robot for everyone and ends the viewer's live view; there is no Resume step.
  const b = await (await browser.newContext({ storageState: STATE })).newPage()
  await b.goto(ROBOT)
  await goLive(b, 'Viewer')
  await b.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(b.getByRole('button', { name: 'Live view', exact: true })).toBeVisible()
  await expect(a.getByText(/Operator · Stopped/)).toBeVisible()
  await expect(a.getByRole('button', { name: 'Resume' })).toHaveCount(0)

  // The operator's Stop leaves live view in one click; the editing tools come back.
  await a.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(a.getByRole('button', { name: 'Live view', exact: true })).toBeVisible()
  await expect(a.getByRole('toolbar', { name: 'Stage tools' })).toBeVisible()
  await expect(a.getByText('Power budget')).toBeVisible()
  await expect(a.getByRole('region', { name: 'Live telemetry and analysis' })).toHaveCount(0)

  // Live view again goes straight to holding the pose, not to a stopped state that needs resuming.
  await goLive(b, 'Operator')
  await expect(b.getByText(/Operator · Manual/)).toBeVisible()
  await a.context().close()
  await b.context().close()
})

// Phase 4: cutting the sim turns Signal to Lost and Comms to failed within 2 s, and reconnecting restores it.
// Set E2E_SIM_CONTAINER (e.g. sim-sim-1) to run it; it stops and starts that Docker container.
test('sim outage shows Lost and recovers', async ({ page }) => {
  const container = process.env.E2E_SIM_CONTAINER
  test.skip(!container, 'set E2E_SIM_CONTAINER to the sim container name')
  await page.goto(ROBOT)
  await goLive(page, 'Operator')
  await page.getByRole('tab', { name: 'Simulation' }).click()
  await expect(page.locator('.sim-tab__tiles')).toContainText('Good')

  execSync(`docker kill ${container}`)
  try {
    const killedAt = Date.now()
    await expect(page.locator('.sim-tab__tiles')).toContainText('Lost', { timeout: 5000 })
    const lostAfter = Date.now() - killedAt
    console.log(`Signal Lost ${lostAfter} ms after the sim was killed`)
    expect(lostAfter).toBeLessThan(2000)
    // Whether the relay is still retrying or has given up, the Comms check must not claim OK.
    await page.getByRole('tab', { name: 'Control' }).click()
    await expect(page.locator('.control-panel--right')).toContainText(/Disconnected|Reconnecting/)
  } finally {
    execSync(`docker start ${container}`)
  }
  // Recovery: the page reconnects on its own while retrying; after giving up, Live view brings it back.
  await goLive(page, 'Operator')
  await page.getByRole('tab', { name: 'Simulation' }).click()
  await expect(page.locator('.sim-tab__tiles')).toContainText(/Good|Degraded/, { timeout: 30_000 })
})

// Safety at the protocol level, bypassing the page: joint commands are refused while the task runs and for viewers,
// and accepted from the operator only in Manual hold.
test('relay gates joint commands on Manual hold and the operator role', async ({ baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'protocol-level check; one engine is enough')
  type ClientInit = MessageInitShape<typeof ClientMessageSchema>
  const connect = async (id: string, role: Role) => {
    const client = await rawClient(baseURL!, id, role)
    await expect.poll(() => last(client.messages, 'session')).toMatchObject({ grantedRole: role })
    return client
  }
  const denied = (messages: ServerMessage[], text: string) =>
    expect
      .poll(() => messages.find((m) => m.msg.case === 'event' && m.msg.value.kind === EventKind.DENIED && m.msg.value.message === text))
      .toBeTruthy()
  const lastTelemetry = (messages: ServerMessage[]) => last(messages, 'telemetry')
  const jointTargets: ClientInit = { msg: { case: 'jointTargets', value: { jointIndex: [0], target: [0.3] } } }

  const op = await connect('e2e-op', Role.OPERATOR)
  const viewer = await connect('e2e-viewer', Role.VIEWER)

  // Task running: refused, the sim stays on its task.
  op.send({ msg: { case: 'setMode', value: { mode: Mode.AUTO } } })
  await expect.poll(() => lastTelemetry(op.messages)?.mode).toBe(Mode.AUTO)
  op.send(jointTargets)
  await denied(op.messages, 'a policy is playing: pause it to move joints')
  const after = op.messages.length
  await expect.poll(() => op.messages.slice(after).filter((m) => m.msg.case === 'telemetry').length).toBeGreaterThan(5)
  for (const m of op.messages.slice(after)) if (m.msg.case === 'telemetry') expect(m.msg.value.mode).toBe(Mode.AUTO)

  // Manual hold: the operator's target reaches the sim; a viewer's never does.
  op.send({ msg: { case: 'setMode', value: { mode: Mode.MANUAL } } })
  await expect.poll(() => lastTelemetry(op.messages)?.mode).toBe(Mode.MANUAL)
  viewer.send({ msg: { case: 'jointTargets', value: { jointIndex: [0], target: [-0.5] } } })
  await denied(viewer.messages, 'only the operator can move joints')
  op.send(jointTargets)
  await expect.poll(() => lastTelemetry(op.messages)?.target[0]).toBeCloseTo(0.3, 5)
  op.ws.close()
  viewer.ws.close()
})

// Safety: a page that joins a session already in Manual hold must not push its own preview pose, nor replay a
// preview-only edit through undo.
test('joining a held session sends no joint targets', async ({ page, baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough')
  // A preview-only edit before going live: undo must not replay it onto the robot later.
  await page.goto(ROBOT)
  // The first click can land before hydration: repeat until the tool is on, then wait for the model.
  const controlTool = page.getByRole('toolbar', { name: 'Stage tools' }).getByRole('button', { name: 'Control joint' })
  await expect(async () => {
    await controlTool.click()
    await expect(controlTool).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 })
  }).toPass()
  await expect(page.getByText(/^Loading (model|\d+ of)/)).toHaveCount(0)
  await selectPart(page)
  await nudge(page, 2)
  const name = await jointName(page)

  // Put the sim in Manual hold with that joint at mid-range, as another operator, then leave.
  const hold = await rawClient(baseURL!, 'e2e-hold', Role.OPERATOR)
  const { messages: seen, send } = hold
  await expect.poll(() => last(seen, 'session')?.grantedRole).toBe(Role.OPERATOR)
  const spec = last(seen, 'welcome')!.robot!.joints
  const idx = spec.findIndex((j) => j.name === name)
  expect(idx).toBeGreaterThanOrEqual(0)
  const mid = (spec[idx]!.rangeMin + spec[idx]!.rangeMax) / 2
  send({ msg: { case: 'setMode', value: { mode: Mode.MANUAL } } })
  await expect.poll(() => last(seen, 'telemetry')?.mode).toBe(Mode.MANUAL)
  send({ msg: { case: 'jointTargets', value: { jointIndex: [idx], target: [mid] } } })
  await expect.poll(() => last(seen, 'telemetry')?.target[idx]).toBeCloseTo(mid, 5)
  // Wait until the arm has actually reached it, so the page below sees a settled pose.
  await expect.poll(() => Math.abs((last(seen, 'telemetry')?.qpos[idx] ?? 0) - mid), { timeout: 10_000 }).toBeLessThan(0.005)
  const settled = Math.round(last(seen, 'telemetry')!.qpos[idx]! * DEG)
  hold.ws.close()

  const sent = recordJointTargets(page)
  await goLive(page, 'Operator')
  await expect(page.getByText(/Operator · Manual/)).toBeVisible()
  // The pad shows the robot's pose, not the preview: the first sync has happened.
  await expect.poll(() => padValue(page)).toBe(settled)
  await page.keyboard.press('ControlOrMeta+z')
  // Negative check: give the page several animation frames and 5 Hz publishes to (wrongly) send something.
  await page.waitForTimeout(1000)
  expect(sent).toEqual([])
  expect(await padValue(page)).toBe(settled)
})

// One operator on two devices (the visionOS app and the Control page it opens): the same pairing token shares the lock.
test('paired devices share the operator lock', async ({ baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'protocol-level check; one engine is enough')
  const a = await rawClient(baseURL!, 'e2e-pair-a', Role.OPERATOR, 'e2e-pair-aaaaaaaaaaaa')
  await expect.poll(() => last(a.messages, 'session')?.grantedRole).toBe(Role.OPERATOR)
  const b = await rawClient(baseURL!, 'e2e-pair-b', Role.OPERATOR, 'e2e-pair-aaaaaaaaaaaa')
  await expect.poll(() => last(b.messages, 'session')?.grantedRole).toBe(Role.OPERATOR)
  expect(last(b.messages, 'session')?.operatorId).not.toBe('')
  // A different token is somebody else: a viewer.
  const c = await rawClient(baseURL!, 'e2e-pair-c', Role.OPERATOR, 'e2e-pair-bbbbbbbbbbbb')
  await expect.poll(() => last(c.messages, 'session')?.grantedRole).toBe(Role.VIEWER)

  a.send({ msg: { case: 'setMode', value: { mode: Mode.MANUAL } } })
  await expect.poll(() => last(b.messages, 'telemetry')?.mode).toBe(Mode.MANUAL)
  b.send({ msg: { case: 'jointTargets', value: { jointIndex: [0], target: [0.25] } } })
  await expect.poll(() => last(b.messages, 'telemetry')?.target[0]).toBeCloseTo(0.25, 5)
  a.send({ msg: { case: 'jointTargets', value: { jointIndex: [0], target: [-0.25] } } })
  await expect.poll(() => last(a.messages, 'telemetry')?.target[0]).toBeCloseTo(-0.25, 5)

  // The lock stays while one paired device remains.
  const before = b.messages.length
  a.ws.close()
  await expect.poll(() => b.messages.slice(before).some((m) => m.msg.case === 'session')).toBe(true)
  expect(last(b.messages, 'session')).toMatchObject({ grantedRole: Role.OPERATOR })
  expect(last(b.messages, 'session')?.operatorId).not.toBe('')
  const released = (m: ServerMessage) => m.msg.case === 'event' && m.msg.value.message === 'Control released'
  expect(b.messages.slice(before).some(released)).toBe(false)

  // Released when the last one closes.
  const beforeC = c.messages.length
  b.ws.close()
  await expect.poll(() => c.messages.slice(beforeC).some(released)).toBe(true)
  await expect.poll(() => last(c.messages, 'session')?.operatorId).toBe('')
  c.ws.close()
})

// The page opened from the visionOS app follows joints the app moves: the pad shows the new angle, nothing is sent back.
test("the page follows a paired operator's joint edits", async ({ page, baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough')
  const token = 'e2e-pair-cccccccccccc'
  const sent = recordJointTargets(page)
  await page.goto(`${ROBOT}?pair=${token}`)
  await goLive(page, 'Operator')
  await expect(page.getByText(/Operator · Manual/)).toBeVisible()
  await expect.poll(() => hz(page)).toBeGreaterThan(0)
  await expect(page.getByRole('region', { name: 'Live telemetry and analysis' })).toBeVisible()
  await selectPart(page)
  const name = await jointName(page)

  const app = await rawClient(baseURL!, 'e2e-pair-app', Role.OPERATOR, token)
  await expect.poll(() => last(app.messages, 'session')?.grantedRole).toBe(Role.OPERATOR)
  const spec = last(app.messages, 'welcome')!.robot!.joints
  const idx = spec.findIndex((j) => j.name === name)
  expect(idx).toBeGreaterThanOrEqual(0)
  const mid = (spec[idx]!.rangeMin + spec[idx]!.rangeMax) / 2
  // A target clearly away from where the joint is, so the pad has to move.
  const goal = Math.abs((await padValue(page)) - mid * DEG) > 5 ? mid : mid + 0.2
  app.send({ msg: { case: 'jointTargets', value: { jointIndex: [idx], target: [goal] } } })
  await expect.poll(() => padValue(page)).toBe(Math.round(goal * DEG))
  // Negative check: the page adopted the edit without echoing it back.
  await page.waitForTimeout(1000)
  expect(sent).toEqual([])
  app.ws.close()
})

// A repeated Welcome from the same sim session (the sim re-sends it whenever a camera connects or drops) must not
// overwrite the operator's edits in Manual hold or clear undo.
test('a repeated Welcome keeps Manual hold edits', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough')
  let lastWelcome: Buffer | null = null
  let replay: (() => void) | null = null
  await page.routeWebSocket(/\/ws\/robots\//, (ws) => {
    const server = ws.connectToServer()
    ws.onMessage((m) => server.send(m))
    server.onMessage((m) => {
      if (typeof m !== 'string' && fromBinary(ServerMessageSchema, new Uint8Array(m)).msg.case === 'welcome') lastWelcome = m
      ws.send(m)
    })
    replay = () => lastWelcome && ws.send(lastWelcome)
  })
  await page.goto(ROBOT)
  await goLive(page, 'Operator')
  await page.getByRole('tab', { name: 'Simulation' }).click()
  await page.getByRole('button', { name: 'Manual hold' }).click()
  await expect(page.getByText(/Operator · Manual/)).toBeVisible()
  await page.getByRole('tab', { name: 'Control' }).click()
  await selectPart(page)
  const expected = Math.round(await nudge(page, 5))
  await expect.poll(() => padValue(page)).toBe(expected)

  replay!()
  // Negative check: several 5 Hz publishes after the replayed Welcome must not move the joint.
  await page.waitForTimeout(1000)
  expect(await padValue(page)).toBe(expected)
  // Undo history survived too: the pad's steps merge into one undo step, so undo returns to the start.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => padValue(page)).not.toBe(expected)
})

// Stop pressed while the page is reconnecting must still reach the robot: it is sent as soon as the socket opens,
// and only then does the page leave live view.
test('Stop during a reconnect is delivered once the link is back', async ({ page, baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough')
  let blocked = false
  let dropCurrent: (() => void) | null = null
  await page.routeWebSocket(/\/ws\/robots\//, (ws) => {
    if (blocked) {
      ws.close({ code: 1011, reason: 'test: link down' })
      return
    }
    const server = ws.connectToServer()
    ws.onMessage((m) => server.send(m))
    server.onMessage((m) => ws.send(m))
    dropCurrent = () => ws.close({ code: 1011, reason: 'test: link down' })
  })
  await page.goto(ROBOT)
  await goLive(page, 'Operator')
  await playButton(page, 'Joint sweep').click()
  await expect(page.getByText(/Operator · Playing/)).toBeVisible()

  // Watch the sim's mode from a separate client.
  const watch = await rawClient(baseURL!, 'e2e-watch', Role.VIEWER, '', 6)
  const mode = () => last(watch.messages, 'telemetry')?.mode
  await expect.poll(mode).toBe(Mode.AUTO)

  // The link drops and stays down; Stop now waits for it.
  blocked = true
  dropCurrent!()
  await expect(page.getByText('Reconnecting…')).toBeVisible()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByText(/Stopping: sending as soon as the connection is back/)).toBeVisible()
  expect(mode()).toBe(Mode.AUTO) // not delivered yet: the robot is still on its task

  // The link comes back: the E-stop reaches the sim, then the page leaves live view.
  blocked = false
  await expect.poll(mode, { timeout: 15_000 }).toBe(Mode.STOPPED)
  await expect(page.locator('.control-head__actions').getByRole('button', { name: 'Live view', exact: true })).toBeVisible()
  watch.ws.close()

  // Leave the sim holding its pose for the next test.
  await page.getByRole('tab', { name: 'Control' }).click()
  await goLive(page, 'Operator')
  await expect(page.getByText(/Operator · Manual/)).toBeVisible()
})

// Right panel while live: one card per camera; enlarge in a modal; pop out a picture-in-picture window that can be
// dragged by its title bar and resized from its corner. Video needs Cloudflare Realtime credentials (.dev.vars).
test('camera cards: enlarge and picture in picture', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'one engine is enough')
  await page.goto(ROBOT)
  await goLive(page, 'Operator')
  const rail = page.getByRole('region', { name: 'Robot cameras' })
  await expect(rail.locator('.camera-card')).toHaveCount(2) // franka_fr3: third_person, rear
  await expect(page.locator('.control-stats')).toHaveCount(0) // the tiles gave way to the cameras
  // Skip only when this setup has no Realtime credentials (the relay answers 503); with credentials, streams must work.
  const subscribe = await page.request.post('/api/live/robots/franka_fr3/cameras/subscribe')
  test.skip(subscribe.status() === 503 && /credentials/i.test(await subscribe.text()), 'no Cloudflare Realtime credentials')
  const pipButton = rail.getByRole('button', { name: 'Picture in picture' }).first()
  await expect(pipButton).toBeEnabled({ timeout: 30_000 })

  await rail.getByRole('button', { name: 'Enlarge' }).first().click()
  const modal = page.getByRole('dialog').filter({ hasText: 'Third person' }).filter({ has: page.locator('.camera-modal__video') })
  await expect(modal.locator('video')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(modal).toBeHidden()

  await pipButton.click()
  const pip = page.getByRole('dialog', { name: 'Third person camera, picture in picture' })
  await expect(pip.locator('video')).toBeVisible()
  const start = (await pip.boundingBox())!
  const head = (await pip.locator('.camera-pip__head').boundingBox())!
  await page.mouse.move(head.x + 40, head.y + 10)
  await page.mouse.down()
  await page.mouse.move(head.x - 300, head.y - 200, { steps: 6 })
  await page.mouse.up()
  const moved = (await pip.boundingBox())!
  expect(moved.x).toBeCloseTo(start.x - 340, -1)
  expect(moved.width).toBe(start.width)

  const corner = (await pip.locator('.camera-pip__resize').boundingBox())!
  await page.mouse.move(corner.x + 8, corner.y + 8)
  await page.mouse.down()
  await page.mouse.move(corner.x + 128, corner.y + 8, { steps: 6 })
  await page.mouse.up()
  const resized = (await pip.boundingBox())!
  expect(resized.width).toBeCloseTo(moved.width + 120, -1)
  expect(resized.height).toBeGreaterThan(moved.height) // keeps the camera's aspect ratio

  // Selecting a joint swaps the right panel to Joint control; the floating window stays open, as it does across tabs.
  await selectPart(page)
  await expect(page.getByRole('region', { name: 'Robot cameras' })).toHaveCount(0)
  await expect(pip.locator('video')).toBeVisible()
  await page.getByRole('tab', { name: 'Simulation' }).click()
  await expect(pip.locator('video')).toBeVisible()
  await page.getByRole('tab', { name: 'Control' }).click()

  await pip.getByRole('button', { name: 'Close picture in picture' }).click()
  await expect(pip).toHaveCount(0)

  // Ending live view closes any window still open.
  await page.keyboard.press('Escape') // back to the health panel, where the rail lives
  await page.getByRole('region', { name: 'Robot cameras' }).getByRole('button', { name: 'Picture in picture' }).first().click()
  await expect(pip).toBeVisible()
  await page.locator('.control-head__actions').getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(pip).toHaveCount(0)
  await goLive(page, 'Operator') // leave the sim held, not stopped, for later tests
})
