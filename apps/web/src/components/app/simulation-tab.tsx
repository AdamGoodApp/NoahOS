import {
  Button,
  ContainedList,
  ContainedListItem,
  DataTable,
  Dropdown,
  InlineNotification,
  Loading,
  ProgressBar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
  Tile,
} from '@carbon/react'
import { Download, Play, RecordingFilled, StopFilledAlt } from '@carbon/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { EventKind, JointKind, Mode, Role, type CameraSpec, type JointSpec, type Telemetry } from '@/gen/noahos/sim/v1/sim_pb'
import type { CameraState } from '@/lib/live/cameras'
import type { LiveCameras } from '@/lib/live/use-cameras'
import { CameraVideo } from './camera-video'
import type { LiveClient, LiveState } from '@/lib/live/client'
import { RAD_TO_DEG } from './joint-control'
import { LiveStatTiles, MODE_LABEL, clockTime, formatUptime, ms } from './live-tiles'

type Episode = { file: string; bytes: number; task_label?: string; duration_s?: number }

/** Simulation tab: camera dock, telemetry tiles, console, control mode, episodes, task and joint table (STACK.md §7.5). */
export function SimulationTab({ robotId, client, live, cameras }: { robotId: string; client: LiveClient; live: LiveState; cameras: LiveCameras }) {
  if (live.status !== 'live' || !live.welcome) {
    return (
      <div className="sim-tab sim-tab--empty">
        <Tile className="sim-tab__empty">
          <h2 className="sim-tab__empty-title">Go live to see cameras and telemetry</h2>
          <p className="sim-tab__empty-text">
            The simulation streams joint telemetry, robot cameras and session events while live view is on.
          </p>
          <Button
            kind="primary"
            size="md"
            renderIcon={Play}
            disabled={live.status === 'connecting' || live.status === 'reconnecting'}
            onClick={() => client.connect()}
          >
            Live view
          </Button>
        </Tile>
      </div>
    )
  }
  return <SimulationLive robotId={robotId} client={client} live={live} camerasLive={cameras} />
}

function SimulationLive({ robotId, client, live, camerasLive }: { robotId: string; client: LiveClient; live: LiveState; camerasLive: LiveCameras }) {
  const welcome = live.welcome!
  const t = live.telemetry
  const operator = live.session?.grantedRole === Role.OPERATOR
  const cameras = welcome.cameras
  const published = cameras.some((c) => c.sfuSessionId)
  const camState = camerasLive.state
  const policy = welcome.policies.find((p) => p.id === live.policy)

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="sim-tab">
      <CameraDock
        cameras={cameras}
        state={published ? camState : { status: 'unavailable', message: 'no Realtime credentials', feeds: [] }}
        uptime={live.liveSince ? formatUptime(now - live.liveSince) : '00:00:00'}
        roleLabel={operator ? 'Operator connected' : 'Viewing'}
        onRetry={camerasLive.retry}
      />

      <div className="sim-tab__row">
        <LiveStatTiles live={live} className="sim-tab__tiles" />

        <ContainedList label="Device console" size="sm" className="sim-tab__console">
          {live.events.slice(0, 8).map((e) => (
            <ContainedListItem key={e.id}>
              <span className="sim-tab__console-line">
                <span className="sim-tab__console-time">[{clockTime(e.at)}]</span>{' '}
                <span className={e.kind === EventKind.ERROR || e.kind === EventKind.DENIED ? 'sim-tab__console-error' : undefined}>
                  {e.message}
                </span>
              </span>
            </ContainedListItem>
          ))}
          {live.events.length === 0 && <ContainedListItem>No events yet</ContainedListItem>}
        </ContainedList>

        <div className="sim-tab__mode">
          <p className="sim-tab__section-title">Control mode</p>
          <div className="sim-tab__mode-buttons">
            <Button
              kind={live.mode === Mode.MANUAL ? 'primary' : 'tertiary'}
              size="md"
              disabled={!operator}
              onClick={() => client.hold()}
            >
              Manual hold
            </Button>
          </div>
          <p className="sim-tab__note">
            {operator
              ? 'Going live holds the pose; play a policy from the Policies panel (Control tab). Stop (header) halts the robot and ends live view.'
              : 'Viewing: only the operator can change the mode. Stop (header) works for everyone.'}
          </p>
          <Episodes robotId={robotId} client={client} live={live} operator={operator} />
        </div>
      </div>

      <div className="sim-tab__task">
        <ProgressBar
          label={`${policy?.name ?? 'Policy'} · cycle ${t?.taskCycle ?? 0} · ${MODE_LABEL[live.mode]}`}
          helperText={policy?.description}
          value={(t?.taskPhase ?? 0) * 100}
          max={100}
          size="small"
        />
      </div>

      <JointTable joints={welcome.robot?.joints ?? []} t={t} />
    </div>
  )
}

function CameraDock({
  cameras,
  state,
  uptime,
  roleLabel,
  onRetry,
}: {
  cameras: CameraSpec[]
  state: CameraState
  uptime: string
  roleLabel: string
  onRetry(): void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const main = state.feeds.find((f) => f.name === selected) ?? state.feeds[0] ?? null
  const spec = cameras.find((c) => c.name === main?.name) ?? cameras[0]
  const items = cameras.map((c) => c.name)
  const st = main?.stats

  return (
    <section className="camera-dock" aria-label="Robot cameras">
      <div className="camera-dock__main">
        {main ? <CameraVideo className="camera-dock__video" feed={main} label={`${main.name} camera`} /> : <div className="camera-dock__placeholder" />}
        {state.status === 'connecting' && (
          <div className="camera-dock__status" role="status">
            <Loading withOverlay={false} small />
            <span>Connecting cameras…</span>
          </div>
        )}
        {(state.status === 'unavailable' || state.status === 'error') && (
          <div className="camera-dock__status">
            <InlineNotification
              kind={state.status === 'error' ? 'error' : 'info'}
              lowContrast
              hideCloseButton
              title="Camera stream unavailable"
              subtitle={state.message ?? undefined}
            />
            {state.status === 'error' && (
              <Button kind="tertiary" size="sm" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        )}
        <div className="camera-dock__overlay camera-dock__overlay--tl">
          <Dropdown
            id="camera-select"
            size="sm"
            hideLabel
            titleText="Camera"
            label="Camera"
            items={items}
            selectedItem={main?.name ?? items[0] ?? null}
            onChange={({ selectedItem }) => setSelected(selectedItem ?? null)}
          />
          {spec && (
            <Tag type="high-contrast" size="sm">
              {`${spec.width}×${spec.height} · ${st?.fps != null ? Math.round(st.fps) : spec.fps} fps${st?.kbps != null ? ` · ${(st.kbps / 1000).toFixed(1)} Mbps` : ''}`}
            </Tag>
          )}
        </div>
        <div className="camera-dock__overlay camera-dock__overlay--tr">
          <Tag type="high-contrast" size="sm">
            {roleLabel}
          </Tag>
        </div>
        <div className="camera-dock__overlay camera-dock__overlay--bl">
          <Tag type="high-contrast" size="sm">
            {uptime}
          </Tag>
        </div>
        {st && (
          <div className="camera-dock__overlay camera-dock__overlay--br">
            <Tag type="high-contrast" size="sm">
              {`jitter buffer ${ms(st.jitterBufferMs)} · decode ${ms(st.decodeMs, 1)} · ${st.lost} lost`}
            </Tag>
          </div>
        )}
      </div>
      {state.feeds.length > 1 && (
        <div className="camera-dock__thumbs" role="list" aria-label="Other cameras">
          {state.feeds
            .filter((f) => f !== main)
            .map((f) => (
              <button key={f.name} type="button" role="listitem" className="camera-dock__thumb" onClick={() => setSelected(f.name)}>
                <CameraVideo className="camera-dock__video" feed={f} label={`${f.name} camera`} />
                <span className="camera-dock__thumb-label">{f.name}</span>
              </button>
            ))}
        </div>
      )}
    </section>
  )
}

function Episodes({ robotId, client, live, operator }: { robotId: string; client: LiveClient; live: LiveState; operator: boolean }) {
  const [label, setLabel] = useState('')
  const [episodes, setEpisodes] = useState<Episode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recording = live.telemetry?.recording ?? false
  const base = `/api/live/robots/${encodeURIComponent(robotId)}/episodes`
  const lastRecordingEvent = live.events.find((e) => e.kind === EventKind.RECORDING)?.id

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(base)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const body: unknown = await r.json()
      setEpisodes(Array.isArray(body) ? body.filter(isEpisode) : [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [base])

  useEffect(() => {
    void refresh()
  }, [refresh, lastRecordingEvent])

  return (
    <div className="sim-tab__episodes">
      <div className="sim-tab__record">
        <TextInput
          id="episode-label"
          size="sm"
          labelText="Task label"
          hideLabel
          placeholder="Task label (optional)"
          value={label}
          disabled={!operator || recording}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button
          kind={recording ? 'danger--tertiary' : 'tertiary'}
          size="sm"
          renderIcon={recording ? StopFilledAlt : RecordingFilled}
          disabled={!operator}
          onClick={() => client.record(!recording, label)}
        >
          {recording ? 'Stop recording' : 'Record episode'}
        </Button>
      </div>
      <ContainedList label="Episodes (MCAP)" size="sm">
        {error && <ContainedListItem>Could not list episodes: {error}</ContainedListItem>}
        {episodes?.length === 0 && <ContainedListItem>No episodes yet</ContainedListItem>}
        {episodes?.map((e) => (
          <ContainedListItem
            key={e.file}
            action={
              <Button kind="ghost" size="sm" hasIconOnly renderIcon={Download} iconDescription="Download" href={`${base}/${encodeURIComponent(e.file)}`} />
            }
          >
            <span className="sim-tab__episode-name">{e.task_label || e.file}</span>
            <span className="sim-tab__episode-meta">
              {[e.duration_s != null ? `${e.duration_s.toFixed(1)} s` : null, `${(e.bytes / 1e6).toFixed(1)} MB`].filter(Boolean).join(' · ')}
            </span>
          </ContainedListItem>
        ))}
      </ContainedList>
      <p className="sim-tab__note">Episodes live on the sim's disk; download them before the session ends.</p>
    </div>
  )
}

function isEpisode(v: unknown): v is Episode {
  return !!v && typeof v === 'object' && 'file' in v && typeof v.file === 'string' && 'bytes' in v && typeof v.bytes === 'number'
}

const JOINT_HEADERS = [
  { key: 'joint', header: 'Joint' },
  { key: 'position', header: 'Position' },
  { key: 'velocity', header: 'Velocity' },
  { key: 'torque', header: 'Torque' },
  { key: 'power', header: 'Power (W)' },
  { key: 'temp', header: 'Temp °C (modelled)' },
  { key: 'target', header: 'Target' },
]

/** Updated with the live client's 5 Hz slow publish, so the table stays cheap. */
function JointTable({ joints, t }: { joints: JointSpec[]; t: Telemetry | null }) {
  const rows = useMemo(
    () =>
      joints.map((j, i) => {
        const hinge = j.kind !== JointKind.SLIDE
        const pos = (v: number | undefined) => (v === undefined ? '—' : hinge ? `${(v * RAD_TO_DEG).toFixed(1)}°` : `${(v * 1000).toFixed(0)} mm`)
        const vel = t?.qvel[i]
        return {
          id: j.name,
          joint: j.name,
          position: pos(t?.qpos[i]),
          velocity: vel === undefined ? '—' : hinge ? `${(vel * RAD_TO_DEG).toFixed(0)}°/s` : `${(vel * 1000).toFixed(0)} mm/s`,
          torque: t?.torque[i] === undefined ? '—' : `${t.torque[i]!.toFixed(2)} ${hinge ? 'N·m' : 'N'}`,
          power: t?.powerW[i] === undefined ? '—' : t.powerW[i]!.toFixed(2),
          temp: t?.motorTempC[i] === undefined ? '—' : t.motorTempC[i]!.toFixed(1),
          target: j.actuated ? pos(t?.target[i]) : 'passive',
        }
      }),
    [joints, t],
  )
  return (
    <div className="sim-tab__joints">
      <DataTable rows={rows} headers={JOINT_HEADERS} size="sm">
        {({ rows: tableRows, headers, getTableProps, getHeaderProps, getRowProps, getTableContainerProps }) => (
          <TableContainer title="Joints" description="Live state from the simulation" {...getTableContainerProps()}>
            <Table {...getTableProps()}>
              <TableHead>
                <TableRow>
                  {headers.map((h) => {
                    const { key, ...rest } = getHeaderProps({ header: h })
                    return (
                      <TableHeader key={key} {...rest}>
                        {h.header}
                      </TableHeader>
                    )
                  })}
                </TableRow>
              </TableHead>
              <TableBody>
                {tableRows.map((row) => {
                  const { key, ...rest } = getRowProps({ row })
                  return (
                    <TableRow key={key} {...rest}>
                      {row.cells.map((cell) => (
                        <TableCell key={cell.id}>{cell.value}</TableCell>
                      ))}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DataTable>
    </div>
  )
}
