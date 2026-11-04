import { FLEET, formatAge } from '@/components/app/fleet-data'
import type { JointInfo } from '@/components/app/control-state'

import { clampToRange, rangeDisplay, resolveJoint, toDisplay, toInternal } from './joints'
import { pageContextFor } from './page-context'
import { getCapability, waitForCapability, type ControlApi, type FleetFilters } from './registry'
import {
  cameraWindowDef,
  filterFleetDef,
  getLiveStatusDef,
  getPageContextDef,
  getRobotDef,
  getRobotModelDef,
  listRobotsDef,
  liveViewDef,
  navigateDef,
  openTabDef,
  recordEpisodeDef,
  redoEditDef,
  resetPoseDef,
  runPolicyDef,
  selectPartDef,
  setJointsDef,
  setToolDef,
  setViewDef,
  undoEditDef,
} from './tools'

/** Browser implementations of the assistant tools: they drive the pages through the capability registry. */

export type AgentTarget = { page: 'fleet' } | { page: 'control'; robotId: string }

/** Supplied by the assistant panel (chat and WebMCP): router navigation. */
export type AgentContext = { navigate(target: AgentTarget): Promise<void> }

type Ctx = { context: AgentContext }
type Result = { ok: true; [key: string]: unknown } | { ok: false; reason: string }

class ToolError extends Error {}

/** Tools never throw: the model gets `{ ok: false, reason }` and explains it. */
function safe<I>(fn: (input: I, ctx: Ctx) => Promise<Result> | Result) {
  return async (input: I, ctx: Ctx): Promise<Result> => {
    try {
      return await fn(input, ctx)
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }
}

function robotRecord(id: string) {
  return FLEET.find((r) => r.id === id)
}

function resolveRobotId(robotId: string | undefined): string {
  const id = robotId ?? pageContextFor(location.pathname).robotId ?? getCapability('control')?.robotId
  if (!id) throw new ToolError("Say which robot, or open a robot's Control page first.")
  if (!robotRecord(id)) throw new ToolError(`Unknown robot id "${id}". Use list_robots.`)
  return id
}

function onAuthPage(): boolean {
  return location.pathname.startsWith('/auth')
}

async function ensureControl(robotId: string | undefined, ctx: Ctx): Promise<ControlApi> {
  const id = resolveRobotId(robotId)
  if (getCapability('control')?.robotId !== id) await ctx.context.navigate({ page: 'control', robotId: id })
  try {
    return await waitForCapability('control', (api) => api.robotId === id && api.getState().loadPhase !== 'loading', 30_000).then(
      (api) => {
        const state = api.getState()
        if (state.loadPhase === 'error') throw new ToolError(state.loadError ?? 'The robot model failed to load.')
        return api
      },
    )
  } catch (error) {
    if (error instanceof ToolError) throw error
    if (onAuthPage()) throw new ToolError('Sign in to use the console.')
    throw new ToolError('The Control page did not finish loading.')
  }
}

async function ensureFleet(ctx: Ctx) {
  if (!getCapability('fleet')) await ctx.context.navigate({ page: 'fleet' })
  try {
    return await waitForCapability('fleet', () => true, 15_000)
  } catch {
    if (onAuthPage()) throw new ToolError('Sign in to use the console.')
    throw new ToolError('The fleet dashboard did not open.')
  }
}

function jointView(joint: JointInfo, values: Record<string, number>) {
  const { value, unit } = toDisplay(joint, values[joint.name] ?? 0)
  return { name: joint.name, body: joint.body, type: joint.type, unit, range: rangeDisplay(joint), value }
}

function liveSummary(api: ControlApi) {
  const { live } = api.getState()
  return {
    status: live.status,
    error: live.error,
    mode: live.mode,
    policy: live.policy || null,
    role: live.role,
    policies: live.policies,
    cameras: live.cameras,
  }
}

function requireLive(api: ControlApi) {
  if (api.getState().live.status !== 'live') throw new ToolError('Start Live view first (live_view start).')
}

const getPageContext = getPageContextDef.client<AgentContext>(
  safe(() => {
    const page = pageContextFor(location.pathname)
    return { ok: true, ...page, robotName: page.robotId ? robotRecord(page.robotId)?.name : undefined }
  }),
)

const listRobots = listRobotsDef.client<AgentContext>(
  safe((input) => {
    const q = input.query?.trim().toLowerCase()
    const robots = FLEET.filter(
      (r) =>
        (!input.status || r.status === input.status) &&
        (!input.category || r.category === input.category) &&
        (!input.site || r.site === input.site) &&
        (!q || [r.name, r.site, r.activity, r.category, r.operator ?? ''].some((f) => f.toLowerCase().includes(q))),
    ).map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      site: r.site,
      status: r.status,
      battery: r.battery,
      operator: r.operator,
      activity: r.activity,
      lastSeen: formatAge(r.lastSeenSec),
    }))
    return { ok: true, count: robots.length, robots }
  }),
)

const getRobot = getRobotDef.client<AgentContext>(
  safe((input) => {
    const r = robotRecord(input.robotId)
    if (!r) return { ok: false, reason: `Unknown robot id "${input.robotId}". Use list_robots.` }
    const { modelUrl: _modelUrl, image: _image, lastSeenSec, ...rest } = r
    return { ok: true, ...rest, lastSeen: formatAge(lastSeenSec), open: getCapability('control')?.robotId === r.id }
  }),
)

const getRobotModel = getRobotModelDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    const s = api.getState()
    return {
      ok: true,
      robotId: s.robotId,
      name: robotRecord(s.robotId)?.name,
      jointCount: s.joints.length,
      joints: s.joints.map((j) => jointView(j, s.values)),
      selected: s.selected,
      tab: s.tab,
      live: liveSummary(api),
    }
  }),
)

const navigate = navigateDef.client<AgentContext>(
  safe(async (input, ctx) => {
    if (input.to === 'robot') {
      if (!input.robotId) return { ok: false, reason: "robotId is required for to:'robot'." }
      const api = await ensureControl(input.robotId, ctx)
      return { ok: true, page: 'control', robotId: api.robotId, path: location.pathname }
    }
    await ensureFleet(ctx)
    return { ok: true, page: 'fleet', path: location.pathname }
  }),
)

const filterFleet = filterFleetDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureFleet(ctx)
    const { clear, ...rest } = input
    if (clear) api.clear()
    const patch: Partial<FleetFilters> = {}
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) (patch as Record<string, unknown>)[key] = value
    }
    api.setFilters(patch)
    return { ok: true, ...api.getState() }
  }),
)

const setJoints = setJointsDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    const s = api.getState()
    if (s.live.status === 'live' && !s.canControl) {
      return {
        ok: false,
        reason:
          'The robot is live but not under your control in Manual mode: use run_policy pause or live_view take_control first.',
      }
    }
    const values: Record<string, number> = {}
    const applied: unknown[] = []
    const skipped: { name: string; reason: string; candidates?: string[] }[] = []
    for (const entry of input.joints) {
      const match = resolveJoint(s.joints, entry.name)
      if ('error' in match) {
        skipped.push({ name: entry.name, reason: match.error, candidates: match.candidates })
        continue
      }
      try {
        const { value, clamped } = clampToRange(match.joint, toInternal(match.joint, entry.value, entry.unit))
        values[match.joint.name] = value
        applied.push({ name: match.joint.name, ...toDisplay(match.joint, value), clamped, range: rangeDisplay(match.joint) })
      } catch (error) {
        skipped.push({ name: entry.name, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    if (!applied.length) return { ok: false, reason: `No joint was set: ${skipped.map((j) => j.reason).join('; ')}`, skipped } as Result
    api.setJoints(values)
    return { ok: true, applied, skipped }
  }),
)

const resetPose = resetPoseDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    const s = api.getState()
    if (s.live.status === 'live' && !s.canControl) {
      return { ok: false, reason: 'The robot is live but not under your control in Manual mode.' }
    }
    api.resetPose()
    return { ok: true }
  }),
)

const selectPart = selectPartDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    const s = api.getState()
    let body: string | null = null
    if (input.body) {
      if (!s.joints.some((j) => j.body === input.body)) {
        const q = input.body.toLowerCase()
        const bodies = [...new Set(s.joints.map((j) => j.body))]
        const candidates = bodies.filter((b) => b.toLowerCase().includes(q)).slice(0, 5)
        return { ok: false, reason: `Unknown body "${input.body}". Candidates: ${candidates.join(', ') || 'none'}.` }
      }
      body = input.body
    } else if (input.joint) {
      const match = resolveJoint(s.joints, input.joint)
      if ('error' in match) return { ok: false, reason: `${match.error}. Candidates: ${match.candidates.join(', ')}.` }
      body = match.joint.body
    }
    api.select(body)
    return { ok: true, selected: body, joints: body ? s.joints.filter((j) => j.body === body).map((j) => jointView(j, s.values)) : [] }
  }),
)

const setView = setViewDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    if (input.preset) api.setView(input.preset)
    if (input.zoomPercent !== undefined) api.setZoom(input.zoomPercent)
    // The viewer reports its camera back through React state; wait until the snapshot shows the request.
    await waitForCapability(
      'control',
      (a) => {
        const { camera } = a.getState()
        return (!input.preset || camera.preset === input.preset) && (input.zoomPercent === undefined || camera.zoomPercent === Math.round(input.zoomPercent))
      },
      2000,
    ).catch(() => undefined)
    return { ok: true, camera: api.getState().camera }
  }),
)

const setTool = setToolDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    if (api.getState().live.status === 'live') return { ok: false, reason: 'The pointer tool is fixed while live.' }
    api.setTool(input.tool)
    return { ok: true, tool: input.tool }
  }),
)

function historyTool(direction: 'undo' | 'redo') {
  return safe<{ robotId?: string; count?: number }>(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    let done = 0
    for (let i = 0; i < (input.count ?? 1); i++) {
      const s = api.getState()
      if (direction === 'undo' ? !s.canUndo : !s.canRedo) break
      if (direction === 'undo') api.undo()
      else api.redo()
      done++
    }
    return { ok: true, [direction === 'undo' ? 'undone' : 'redone']: done }
  })
}

const undoEdit = undoEditDef.client<AgentContext>(historyTool('undo'))
const redoEdit = redoEditDef.client<AgentContext>(historyTool('redo'))

const liveView = liveViewDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    if (input.action === 'start') {
      const live = await api.goLive()
      if (live.status === 'error') return { ok: false, reason: live.error ?? 'Live view failed to start.' }
      return { ok: true, ...liveSummary(api) }
    }
    if (input.action === 'stop') {
      api.stop()
      return { ok: true, status: api.getState().live.status }
    }
    requireLive(api)
    await api.takeControl()
    return { ok: true, ...liveSummary(api) }
  }),
)

const runPolicy = runPolicyDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    requireLive(api)
    const { live } = api.getState()
    if (live.role !== 'operator') return { ok: false, reason: 'You are a viewer: use live_view take_control.' }
    if (input.action === 'pause') {
      const next = await api.hold()
      return { ok: true, mode: next.mode }
    }
    const list = live.policies.map((p) => `${p.name} (${p.id})`).join(', ')
    const wanted = input.policy?.trim()
    if (!wanted) return { ok: false, reason: `Say which policy to play: ${list}.` }
    const byId = live.policies.find((p) => p.id === wanted)
    const byName = live.policies.filter((p) => p.name.toLowerCase() === wanted.toLowerCase())
    const loose = live.policies.filter((p) => p.name.toLowerCase().includes(wanted.toLowerCase()))
    const policy = byId ?? (byName.length === 1 ? byName[0] : loose.length === 1 ? loose[0] : undefined)
    if (!policy) return { ok: false, reason: `No single policy matches "${wanted}". Policies: ${list}.` }
    const next = await api.play(policy.id)
    return { ok: true, mode: next.mode, policy: policy.name }
  }),
)

const recordEpisode = recordEpisodeDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    requireLive(api)
    api.record(input.action === 'start', input.label ?? '')
    return { ok: true, recording: input.action === 'start' }
  }),
)

const openTab = openTabDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    api.setTab(input.tab)
    return { ok: true, tab: input.tab }
  }),
)

const cameraWindow = cameraWindowDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    requireLive(api)
    const { cameras } = api.getState().live
    if (!cameras.includes(input.camera)) {
      return { ok: false, reason: `Unknown camera "${input.camera}". Cameras: ${cameras.join(', ') || 'none'}.` }
    }
    api.cameraWindow(input.camera, input.action)
    return { ok: true, camera: input.camera, action: input.action }
  }),
)

const getLiveStatus = getLiveStatusDef.client<AgentContext>(
  safe(async (input, ctx) => {
    const api = await ensureControl(input.robotId, ctx)
    return { ok: true, ...api.getState().live }
  }),
)

export const clientTools = [
  getPageContext,
  listRobots,
  getRobot,
  getRobotModel,
  navigate,
  filterFleet,
  setJoints,
  resetPose,
  selectPart,
  setView,
  setTool,
  undoEdit,
  redoEdit,
  liveView,
  runPolicy,
  recordEpisode,
  openTab,
  cameraWindow,
  getLiveStatus,
] as const

const READ_ONLY: Record<string, true> = {
  get_page_context: true,
  list_robots: true,
  get_robot: true,
  get_robot_model: true,
  get_live_status: true,
}

function titleFor(name: string): string {
  const text = name.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** WebMCP per-tool options: a title, and read-only hints for the tools that change nothing. */
export const webmcpToolOptions = Object.fromEntries(
  clientTools.map((t) => [t.name, { title: titleFor(t.name), annotations: { readOnlyHint: READ_ONLY[t.name] === true } }]),
)
