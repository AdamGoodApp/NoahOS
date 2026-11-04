import {
  Button,
  ContainedList,
  ContainedListItem,
  Dropdown,
  IconButton,
  preview__IconIndicator as IconIndicator,
  InlineNotification,
  Layer,
  Loading,
  ProgressBar,
  SkeletonPlaceholder,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  Tag,
} from '@carbon/react'
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  ChevronUp,
  Chip,
  Cursor_1,
  Edit,
  Flash,
  Move,
  Redo,
  Renew,
  Reset,
  Save,
  Share,
  Undo,
  Upgrade,
  ZoomIn,
  ZoomOut,
} from '@carbon/icons-react'
import { ClientOnly, useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ComponentType, type Ref } from 'react'

import { Mode, Role, type CameraSpec, type Welcome } from '@/gen/noahos/sim/v1/sim_pb'
import type { LiveClient } from '@/lib/live/client'
import { useLiveCameras } from '@/lib/live/use-cameras'
import { baseJointName, telemetryValues, useLiveClient, useLiveFrame, useLiveState } from '@/lib/live/use-live'

import type { JointStats } from '@/lib/mjcf/build'
import { useRegisterCapability } from '@/lib/agent/registry'
import type { CameraState, ViewPreset } from '@/lib/robot-scene'
import { AppHeader } from './app-header'
import { controlReducer, humanize, initialControlState, type Tool } from './control-state'
import { createAimStore, isAtLimit } from './joint-control'
import { JointControlPanel } from './joint-control-panel'
import type { Robot } from './fleet-data'
import type { PadFollow } from './joint-pad'
import { AgeReading, healthChecks, STATUS_KIND, statusText } from './robot-status'
import { CameraRail, CameraWindows, useCameraWindows } from './camera-rail'
import { buildControlApi, type AgentRefs } from './control-agent'
import { LiveAnalysis } from './live-analysis'
import { PolicyPanel } from './policy-panel'
import { LiveControls } from './live-controls'
import { LiveStatTiles, StatTile } from './live-tiles'
import { LogsTab } from './logs-tab'
import { SimulationTab } from './simulation-tab'
import type { RobotViewerHandle, RobotViewerProps } from './robot-viewer'

const NO_CAMERAS: CameraSpec[] = []
/** How long telemetry may still carry a joint's older target after this page commanded it (relay + sim round trip). */
const OWN_ECHO_MS = 1000

const RobotViewer = lazy(() => import('./robot-viewer'))

const SIM_PENDING = 'Arrives with the sim connection'

const ZOOM_ITEMS = [50, 75, 100, 150, 200].map((p) => ({ id: p, text: `Zoom: ${p}%` }))
const VIEW_ITEMS: { id: ViewPreset; text: string }[] = [
  { id: 'iso', text: 'View: Isometric' },
  { id: 'front', text: 'View: Front' },
  { id: 'back', text: 'View: Back' },
  { id: 'left', text: 'View: Left' },
  { id: 'right', text: 'View: Right' },
  { id: 'top', text: 'View: Top' },
]
const TOOLS: { tool: Tool; label: string; icon: ComponentType }[] = [
  { tool: 'camera', label: 'Camera', icon: Camera },
  { tool: 'control', label: 'Control joint', icon: Cursor_1 },
  { tool: 'move', label: 'Move joint', icon: Move },
]
const HINTS: Record<Tool, string> = {
  camera: 'Drag to orbit, right-drag to pan, scroll to zoom',
  control: 'Click a part, then turn its joint with the wheel or the pad',
  move: 'Drag a part; the joints below it follow',
}
const UPDATES = [
  { icon: Upgrade, title: 'Firmware 2.4.1', description: 'Improves lidar mapping', action: 'Install' },
  { icon: Chip, title: 'Policy v0.5', description: 'Trained on 5k teleop episodes', action: 'Deploy' },
  { icon: Camera, title: 'Wrist camera calibration', description: 'Last run 12 days ago', action: 'Run' },
  { icon: Reset, title: 'Gripper pads', description: 'Replace worn pads', action: 'Order' },
  { icon: Flash, title: 'Compute module L3', description: 'Upgrade from basic', action: 'Upgrade' },
]

type Load = { phase: 'loading'; loaded: number; total: number | null } | { phase: 'ready' } | { phase: 'error'; message: string }

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export function ControlPage({ robot, pairToken }: { robot: Robot; pairToken?: string }) {
  const navigate = useNavigate()
  const [state, dispatch] = useReducer(controlReducer, initialControlState)
  const [load, setLoad] = useState<Load>({ phase: 'loading', loaded: 0, total: null })
  const [camera, setCamera] = useState<CameraState>({ zoomPercent: 100, preset: 'iso' })
  const [position, setPosition] = useState<[number, number, number] | null>(null)
  const [jointPick, setJointPick] = useState<string | null>(null)
  const [followAll, setFollowAll] = useState(false)
  const [stats, setStats] = useState<JointStats | null>(null)
  // While live the twin moves every frame; the stats panel refreshes at most 10×/s so the page does not re-render at 60 Hz.
  const statsAt = useRef(0)
  const onJointStats = useCallback((s: JointStats | null) => {
    const now = performance.now()
    if (s && now - statsAt.current < 100) return
    statsAt.current = now
    setStats(s)
  }, [])
  const aimStore = useMemo(createAimStore, [])
  const viewer = useRef<RobotViewerHandle>(null)
  const [tab, setTab] = useState(1)
  // Live dock: the analysis cards row can be hidden; when the dock floats over the stage, its height is passed to the
  // viewer, which zooms out and lifts the robot so it stays in the uncovered part of the view.
  const [analysisOpen, setAnalysisOpen] = useState(true)
  const [dockInset, setDockInset] = useState(0)
  const dockRef = useCallback((dock: HTMLElement | null) => {
    if (!dock) {
      setDockInset(0)
      return
    }
    const measure = () => setDockInset(getComputedStyle(dock).position === 'absolute' ? dock.offsetHeight : 0)
    const observer = new ResizeObserver(measure)
    observer.observe(dock)
    measure()
    return () => observer.disconnect()
  }, [])

  const { info, values, selected, tool, pending } = state

  // Live link to the simulation (STACK.md §7.2): the twin mirrors telemetry.
  const liveClient = useLiveClient(robot.id, pairToken)
  const live = useLiveState(liveClient)
  const welcome = live.status === 'live' ? live.welcome : null
  const isLive = welcome !== null
  const stopped = isLive && live.mode === Mode.STOPPED
  const operator = isLive && live.session?.grantedRole === Role.OPERATOR
  // Safety: while live, joints can be moved only by the operator in Manual hold, never while a task runs or after a
  // Stop. The relay and the sim enforce the same rule. Not live: the page edits its own preview as before.
  const canControl = operator && live.mode === Mode.MANUAL
  const editable = !isLive || canControl
  const baseName = useMemo(() => baseJointName(info?.baseValues), [info])
  // One camera subscription shared by the Simulation tab and the right-panel camera cards.
  const cameras = useLiveCameras(robot.id, welcome)
  // Open camera windows live at page level: they stay open when the right panel switches to a joint or the tab changes.
  // A reconnect keeps them; ending live view (or a failed link) closes them.
  const cameraWindows = useCameraWindows(live.welcome?.cameras ?? NO_CAMERAS, live.status !== 'idle' && live.status !== 'error')
  // The assistant's tools drive this page through a capability that reads the latest render values.
  const agent = useRef<AgentRefs | null>(null)
  agent.current = {
    state,
    load,
    camera,
    tab,
    live,
    canControl,
    editable,
    dispatch,
    cameraWindows: cameraWindows.api,
    setCameraWindows: cameraWindows.setState,
    setTab,
  }
  const controlApi = useMemo(() => buildControlApi(robot.id, liveClient, viewer, agent), [robot.id, liveClient])
  useRegisterCapability('control', controlApi)
  const lastSent = useRef<Record<string, number>>({})
  // The sim's joint targets as this page last knew them; a difference means another paired operator moved a joint.
  // Joints this page commanded within the last second are skipped: frames in flight still carry the older target.
  const seenTarget = useRef<Record<string, number>>({})
  const sentAt = useRef<Record<string, number>>({})

  // The page's values start from the sim's pose once per connection and model (also in Manual hold, so a page that
  // joins a held session never sends its own preview pose), dropping preview-only undo history. Whenever the page
  // cannot control, it keeps following the sim at 5 Hz, so entering Manual hold starts from the live pose.
  // Keyed by the sim session id, not the Welcome object: the sim re-sends Welcome whenever a camera connects or drops,
  // and that must not overwrite the operator's edits or clear undo mid-session.
  const syncedFor = useRef<{ session: string; info: NonNullable<typeof info> } | null>(null)
  useEffect(() => {
    if (!welcome || !info || !live.telemetry) return
    const first = syncedFor.current?.session !== welcome.sessionId || syncedFor.current.info !== info
    if (canControl && !first) {
      // Another paired operator (the visionOS app) moved a joint: the sim's target no longer matches what this page saw.
      const t = live.telemetry
      const now = performance.now()
      const foreign: Record<string, number> = {}
      welcome.robot?.joints.forEach((j, i) => {
        const target = t.target[i]
        const seen = seenTarget.current[j.name]
        if (target === undefined || seen === undefined || Math.abs(target - seen) <= 1e-5) return
        if (now - (sentAt.current[j.name] ?? -Infinity) > OWN_ECHO_MS) foreign[j.name] = target
      })
      if (!Object.keys(foreign).length) return
      seenTarget.current = { ...seenTarget.current, ...foreign }
      lastSent.current = { ...lastSent.current, ...foreign }
      dispatch({ type: 'sync', values: foreign })
      return
    }
    syncedFor.current = { session: welcome.sessionId, info }
    const synced = telemetryValues(welcome, live.telemetry, baseName)
    lastSent.current = synced
    const t = live.telemetry
    seenTarget.current = Object.fromEntries((welcome.robot?.joints ?? []).map((j, i) => [j.name, t.target[i] ?? 0]))
    dispatch({ type: 'sync', values: synced, resetHistory: first })
  }, [welcome, info, live.telemetry, baseName, canControl])

  // In Manual hold, the operator's edits (wheel, pad, cards, IK, undo/redo, poses) become joint targets: only values
  // that changed since the last render, did not come from the live pose, and not from a model (re)load.
  const prevValues = useRef(values)
  const prevInfo = useRef(info)
  useEffect(() => {
    const prev = prevValues.current
    const modelChanged = prevInfo.current !== info
    prevValues.current = values
    prevInfo.current = info
    const synced = !!welcome && syncedFor.current?.session === welcome.sessionId && syncedFor.current.info === info
    if (!canControl || !synced || modelChanged || prev === values) return
    const changed: Record<string, number> = {}
    for (const [name, value] of Object.entries(values)) {
      if (!name.includes('#') && prev[name] !== value && lastSent.current[name] !== value) changed[name] = value
    }
    if (!Object.keys(changed).length) return
    lastSent.current = { ...lastSent.current, ...changed }
    seenTarget.current = { ...seenTarget.current, ...changed }
    const now = performance.now()
    for (const name of Object.keys(changed)) sentAt.current[name] = now
    liveClient.sendTargets(changed)
  }, [values, info, welcome, canControl, liveClient])

  // Going live moves the robot to the sim's pose (legged robots are held higher): frame it once per sim session.
  const framedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!welcome) {
      framedFor.current = null
      return
    }
    if (!live.telemetry || framedFor.current === welcome.sessionId) return
    framedFor.current = welcome.sessionId
    viewer.current?.frameRobot()
  }, [welcome, live.telemetry])

  const bodyJoints = info?.joints.filter((j) => j.body === selected) ?? []
  // The joint the Control tool drives: the one picked in the panel, else the body's last (nearest the part).
  const activeJoint = bodyJoints.find((j) => j.name === jointPick) ?? bodyJoints.at(-1) ?? null
  // Live: the wheel appears only when the operator may move joints (Manual hold); the toolbar is hidden while live.
  const controlJoint = (isLive ? canControl : tool === 'control') ? activeJoint : null
  const activeAtLimit = activeJoint ? isAtLimit(activeJoint, values[activeJoint.name] ?? 0) : false
  // The pad's "All joints follow" mode drags the selected part through the viewer's inverse kinematics.
  const padFollow: PadFollow = {
    begin: () => (selected ? (viewer.current?.ikBegin(selected) ?? false) : false),
    move: (u, v) => viewer.current?.ikMovePad(u, v),
    end: () => viewer.current?.ikEnd(),
  }

  // Keyboard: undo/redo (only when editing is allowed) and clearing the selection.
  const editableRef = useRef(editable)
  editableRef.current = editable
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      const editing = editableRef.current
      if (editing && mod && key === 'z' && !e.shiftKey) dispatch({ type: 'undo' })
      else if (editing && mod && ((key === 'z' && e.shiftKey) || key === 'y')) dispatch({ type: 'redo' })
      else if (e.key === 'Escape') dispatch({ type: 'select', body: null })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onModelLoaded = useCallback((loadedInfo: NonNullable<typeof info>) => {
    dispatch({ type: 'model-loaded', info: loadedInfo })
    setLoad({ phase: 'ready' })
  }, [])
  const onJoint = useCallback(
    (name: string, value: number, phase: 'move' | 'end') => dispatch({ type: 'joint', name, value, commit: phase === 'end', at: Date.now() }),
    [],
  )

  const hint = stopped
    ? 'Stopped by another user — holding pose. Play a policy (Policies panel) or press Manual hold (Simulation tab)'
    : isLive && !operator
      ? 'Viewing: only the operator can move joints. Click a part to see its joint'
      : isLive && !canControl
        ? 'Policy playing: joints are locked. Press Pause (Policies panel) or Manual hold (Simulation tab) to move them'
        : isLive
          ? 'Manual hold: click a part, then turn its joint with the wheel or the pad'
          : tool === 'control' && selected && !activeJoint
            ? 'No joint on this part'
            : HINTS[tool]
  // While live, selecting a part shows its joint; with nothing selected the panel shows robot health.
  const showJointPanel = isLive ? selected !== null : tool !== 'camera'

  const offline = robot.status === 'offline'
  const linkDown = live.status === 'reconnecting' || live.status === 'error'
  const checks = healthChecks(robot, live)

  const stageSkeleton = <SkeletonPlaceholder className="control-stage__skeleton" />

  return (
    <>
      <AppHeader skipTo="#control-stage" />
      {live.welcome && (
        <CameraWindows cameras={live.welcome.cameras} state={cameras.state} windows={cameraWindows.state} setWindows={cameraWindows.setState} />
      )}
      <div className="control-shell">
        <Tabs selectedIndex={tab} onChange={({ selectedIndex }) => setTab(selectedIndex)}>
          <header className="control-head">
            <div className="control-head__title-group">
              <IconButton kind="ghost" size="md" label="Back to dashboard" align="bottom-start" onClick={() => navigate({ to: '/app' })}>
                <ArrowLeft />
              </IconButton>
              <h1 className="control-head__title">{robot.name}</h1>
              <Tag type="gray" size="sm">
                {robot.category}
              </Tag>
              <span className="control-head__status">
                <IconIndicator kind={STATUS_KIND[robot.status]} label={statusText(robot)} />
                <AgeReading robot={robot} stale={offline} />
              </span>
              <IconButton kind="ghost" size="sm" label="Rename" align="bottom" disabled>
                <Edit />
              </IconButton>
            </div>
            <TabList aria-label="Robot views" className="control-head__tabs">
              <Tab disabled>Overview</Tab>
              <Tab>Control</Tab>
              <Tab disabled>Behaviour</Tab>
              <Tab>Simulation</Tab>
              <Tab>Logs</Tab>
            </TabList>
            <div className="control-head__actions">
              <IconButton kind="ghost" size="md" label="Refresh state" align="bottom" disabled>
                <Renew />
              </IconButton>
              <IconButton kind="ghost" size="md" label="Share" align="bottom" disabled>
                <Share />
              </IconButton>
              <IconButton kind="ghost" size="md" label="Save pose" align="bottom" disabled>
                <Save />
              </IconButton>
              <LiveControls client={liveClient} live={live} />
            </div>
          </header>

          <TabPanels>
            <TabPanel className="control-tab-panel" />
            <TabPanel className="control-tab-panel">
              <div className="control-body">
                <aside className="control-panel control-panel--left" aria-label="Policies">
                  <Layer>
                    <PolicyPanel welcome={welcome} live={live} client={liveClient} operator={operator} />
                  </Layer>
                </aside>

                <div className="control-center">
                  <main id="control-stage" className="control-stage" tabIndex={-1} aria-label={`${robot.name} 3D view`}>
                    <ClientOnly fallback={stageSkeleton}>
                      <Suspense fallback={stageSkeleton}>
                        <StageViewer
                          ref={viewer}
                          client={liveClient}
                          welcome={welcome}
                          baseName={baseName}
                          modelUrl={robot.modelUrl}
                          jointValues={values}
                          bottomInset={dockInset}
                          selectedBody={selected}
                          selectedAtLimit={activeAtLimit}
                          controlJoint={controlJoint}
                          statsJoint={showJointPanel ? (activeJoint?.name ?? null) : null}
                          // Live: clicks select parts (Control tool without its wheel); no drag can move a joint.
                          tool={isLive ? 'control' : tool}
                          onModelLoaded={onModelLoaded}
                          onLoadProgress={(loaded, total) => setLoad({ phase: 'loading', loaded, total })}
                          onLoadError={(message) => setLoad({ phase: 'error', message })}
                          onSelect={(body) => dispatch({ type: 'select', body })}
                          onJointDrag={onJoint}
                          onJointsDrag={(changed, phase) =>
                            dispatch({ type: 'joints', values: changed, commit: phase === 'end', at: Date.now() })
                          }
                          onCameraChange={setCamera}
                          onSelectedPosition={(p) => setPosition((old) => (sameMm(old, p) ? old : p))}
                          onJointStats={onJointStats}
                          onControlAim={aimStore.set}
                        />
                      </Suspense>
                    </ClientOnly>

                    <div className="control-stage__info">
                      <p className="control-stage__hint">{hint}</p>
                      {isLive && (
                        <div className="live-tags">
                          <Tag type="gray" size="sm">{`${live.stats.hz} Hz`}</Tag>
                          <Tag type="gray" size="sm">
                            {live.stats.rttMs === null ? 'RTT —' : `${Math.round(live.stats.rttMs)} ms`}
                          </Tag>
                          {welcome.robot?.baseJoint &&
                            !(live.mode === Mode.AUTO && welcome.policies.find((p) => p.id === live.policy)?.holdsBase === false) && (
                            <Tag type="gray" size="sm">
                              base held
                            </Tag>
                          )}
                        </div>
                      )}
                      <dl className="control-readout" aria-label="Selected part position">
                        {(['x', 'y', 'z'] as const).map((axis, i) => (
                          <div key={axis}>
                            <dt>{axis}</dt>
                            <dd>{position ? `${Math.round((position[i] ?? 0) * 1000)} mm` : '—'}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>

                    <div className="control-stage__view">
                      <div className="control-stage__zoom">
                        <IconButton kind="ghost" size="sm" label="Zoom in" align="left" onClick={() => viewer.current?.zoomBy(1.25)}>
                          <ZoomIn />
                        </IconButton>
                        <IconButton kind="ghost" size="sm" label="Zoom out" align="left" onClick={() => viewer.current?.zoomBy(1 / 1.25)}>
                          <ZoomOut />
                        </IconButton>
                      </div>
                      <Dropdown
                        id="control-zoom"
                        size="sm"
                        hideLabel
                        titleText="Zoom"
                        label={`Zoom: ${camera.zoomPercent}%`}
                        items={ZOOM_ITEMS}
                        itemToString={(item) => item?.text ?? ''}
                        selectedItem={ZOOM_ITEMS.find((i) => i.id === camera.zoomPercent) ?? null}
                        onChange={({ selectedItem }) => selectedItem && viewer.current?.setZoomPercent(selectedItem.id)}
                      />
                      <Dropdown
                        id="control-view"
                        size="sm"
                        hideLabel
                        titleText="View"
                        label="View: Custom"
                        items={VIEW_ITEMS}
                        itemToString={(item) => item?.text ?? ''}
                        selectedItem={VIEW_ITEMS.find((i) => i.id === camera.preset) ?? null}
                        onChange={({ selectedItem }) => selectedItem && viewer.current?.setView(selectedItem.id)}
                      />
                    </div>

                    {load.phase === 'loading' && (
                      <div className="control-stage__status" role="status">
                        <Loading withOverlay={false} small />
                        <span>{load.total === null ? 'Loading model…' : `Loading ${load.loaded} of ${load.total} files`}</span>
                      </div>
                    )}
                    {load.phase === 'error' && (
                      <StageError title="Could not load the model" subtitle={load.message} action="Reload" onAction={() => window.location.reload()} />
                    )}
                    {live.status === 'error' && (
                      <StageError title="Live view stopped" subtitle={live.error ?? undefined} action="Retry" onAction={() => liveClient.connect()} />
                    )}

                    {!isLive && (
                    <div className="control-toolbar" role="toolbar" aria-label="Stage tools">
                      {TOOLS.map(({ tool: t, label, icon: Icon }) => (
                        <IconButton
                          key={t}
                          kind="ghost"
                          size="md"
                          label={label}
                          align="top"
                          isSelected={tool === t}
                          aria-pressed={tool === t}
                          onClick={() => dispatch({ type: 'tool', tool: t })}
                        >
                          <Icon />
                        </IconButton>
                      ))}
                      <span className="control-toolbar__divider" aria-hidden="true" />
                      <IconButton kind="ghost" size="md" label="Undo" align="top" disabled={!state.past.length && !pending} onClick={() => dispatch({ type: 'undo' })}>
                        <Undo />
                      </IconButton>
                      <IconButton kind="ghost" size="md" label="Redo" align="top" disabled={!state.future.length} onClick={() => dispatch({ type: 'redo' })}>
                        <Redo />
                      </IconButton>
                      <span className="control-toolbar__divider" aria-hidden="true" />
                      <IconButton kind="ghost" size="md" label="Reset view" align="top" onClick={() => viewer.current?.resetView()}>
                        <Reset />
                      </IconButton>
                    </div>
                    )}
                  </main>

                  {/* Live view swaps the stage tools and placeholder power budget for the live dock (designer request 2026-10-30). */}
                  {isLive ? (
                    <section ref={dockRef} className="live-dock" aria-label="Live telemetry and analysis">
                      <IconButton
                        className="live-dock__toggle"
                        kind="ghost"
                        size="sm"
                        align="left"
                        label={analysisOpen ? 'Hide analysis cards' : 'Show analysis cards'}
                        aria-expanded={analysisOpen}
                        aria-controls="live-analysis"
                        onClick={() => setAnalysisOpen((open) => !open)}
                      >
                        {analysisOpen ? <ChevronDown /> : <ChevronUp />}
                      </IconButton>
                      <LiveStatTiles live={live} className="live-dock__tiles" />
                      {analysisOpen && (
                        <LiveAnalysis robotId={robot.id} welcome={welcome} telemetry={live.telemetry} analytics={live.analytics} />
                      )}
                    </section>
                  ) : (
                    <div className="control-budget">
                      <ProgressBar
                        label="Power budget"
                        helperText="Base 12 W · Arms 24 W · Head 5 W · Compute 17 W — 58 W of 100 W"
                        value={58}
                        max={100}
                        size="small"
                      />
                    </div>
                  )}
                </div>

                {showJointPanel ? (
                  <aside className="control-panel control-panel--right" aria-label="Joint control">
                    <Layer>
                      <JointControlPanel
                        selected={selected ? humanize(selected) : null}
                        joints={bodyJoints}
                        joint={activeJoint}
                        value={activeJoint ? (values[activeJoint.name] ?? 0) : 0}
                        stats={stats}
                        aimStore={aimStore}
                        onPickJoint={setJointPick}
                        onChange={onJoint}
                        followAll={followAll}
                        onFollowAllChange={setFollowAll}
                        follow={padFollow}
                        readOnly={!editable}
                      />
                    </Layer>
                  </aside>
                ) : (
                  <aside className="control-panel control-panel--right" aria-label="Robot health">
                    <Layer>
                      <ContainedList label="Health checks" size="sm">
                        {checks.map((check) => (
                          <ContainedListItem key={check.name}>
                            <span className="control-check">
                              {check.name}
                              <IconIndicator kind={check.kind} label={check.label} />
                            </span>
                          </ContainedListItem>
                        ))}
                      </ContainedList>

                      {/* While live the tiles give way to the robot's cameras (their numbers are in the live dock). */}
                      {isLive ? (
                        <CameraRail cameras={welcome.cameras} state={cameras.state} windows={cameraWindows.api} />
                      ) : (
                        <div className="control-stats">
                          <StatTile
                            caption={offline && robot.battery !== null ? 'Battery, last known' : 'Battery'}
                            value={robot.battery === null ? 'Mains' : `${robot.battery}%`}
                            bar={robot.battery ?? 100}
                          />
                          <StatTile caption="Latency" value={offline || linkDown ? '—' : '34 ms'} bar={offline || linkDown ? 0 : 34} />
                          <StatTile caption="CPU" value={offline || linkDown ? '—' : '79%'} bar={offline || linkDown ? 0 : 79} />
                        </div>
                      )}

                      <ContainedList
                        label="Recommended updates"
                        size="sm"
                        action={
                          <Button kind="ghost" size="sm" disabled title={SIM_PENDING}>
                            View all
                          </Button>
                        }
                      >
                        {UPDATES.map((u) => (
                          <ContainedListItem
                            key={u.title}
                            renderIcon={u.icon}
                            action={
                              <Button kind="ghost" size="sm" disabled title={SIM_PENDING}>
                                {u.action}
                              </Button>
                            }
                          >
                            <span className="control-update__title">{u.title}</span>
                            <span className="control-update__description">{u.description}</span>
                          </ContainedListItem>
                        ))}
                      </ContainedList>
                    </Layer>
                  </aside>
                )}
              </div>
            </TabPanel>
            <TabPanel className="control-tab-panel" />
            <TabPanel className="control-tab-panel">
              {tab === 3 && <SimulationTab robotId={robot.id} client={liveClient} live={live} cameras={cameras} />}
            </TabPanel>
            <TabPanel className="control-tab-panel">
              {tab === 4 && <LogsTab events={live.events} onClear={() => liveClient.clearEvents()} />}
            </TabPanel>
          </TabPanels>
        </Tabs>
      </div>
    </>
  )
}

/** Error notice over the stage with its one recovery action. */
function StageError({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action: string; onAction(): void }) {
  return (
    <div className="control-stage__status control-stage__status--error">
      <InlineNotification kind="error" lowContrast hideCloseButton title={title} subtitle={subtitle} />
      <Button kind="tertiary" size="sm" onClick={onAction}>
        {action}
      </Button>
    </div>
  )
}

type StageViewerProps = RobotViewerProps & {
  ref: Ref<RobotViewerHandle>
  client: LiveClient
  welcome: Welcome | null
  baseName: string | null
}

/** The 3D twin; while live it shows the sim's pose every animation frame without re-rendering the page. */
function StageViewer({ client, welcome, baseName, jointValues, ...props }: StageViewerProps) {
  const frame = useLiveFrame(client)
  const shown = useMemo(
    () => (welcome && frame ? telemetryValues(welcome, frame, baseName, { ...jointValues }) : jointValues),
    [welcome, frame, baseName, jointValues],
  )
  return <RobotViewer {...props} jointValues={shown} />
}

/** The readout shows millimetres; skip re-rendering the page for live motion below that. */
function sameMm(a: [number, number, number] | null, b: [number, number, number] | null): boolean {
  if (!a || !b) return a === b
  return a.every((v, i) => Math.round(v * 1000) === Math.round(b[i]! * 1000))
}
