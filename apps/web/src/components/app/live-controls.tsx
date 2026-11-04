import { Button, InlineLoading, Tag } from '@carbon/react'
import { Play, StopFilledAlt } from '@carbon/icons-react'

import { Mode, Role } from '@/gen/noahos/sim/v1/sim_pb'
import type { LiveClient, LiveState } from '@/lib/live/client'
import { MODE_LABEL } from './live-tiles'

/**
 * Two states: **Live view** goes live (the sim holds its pose; nothing starts on its own) and **Stop** halts the robot
 * and leaves live view in one click, for every role (STACK.md §7.3, §7.8).
 */
export function LiveControls({ client, live }: { client: LiveClient; live: LiveState }) {
  const { status, session, mode } = live
  if (status === 'idle' || status === 'error') {
    return (
      <Button kind="primary" size="md" renderIcon={Play} onClick={() => client.connect()}>
        Live view
      </Button>
    )
  }
  const stop = (
    <Button kind="danger" size="md" renderIcon={StopFilledAlt} onClick={() => client.stop()}>
      Stop
    </Button>
  )
  if (status !== 'live') {
    return (
      <>
        <InlineLoading
          className="live-controls__loading"
          description={
            live.stopping
              ? 'Stopping: sending as soon as the connection is back…'
              : status === 'reconnecting'
                ? 'Reconnecting…'
                : 'Connecting to simulation…'
          }
        />
        {live.stopping ? (
          <Button kind="ghost" size="md" onClick={() => client.close()}>
            Cancel
          </Button>
        ) : (
          stop
        )}
      </>
    )
  }
  const operator = session?.grantedRole === Role.OPERATOR
  return (
    <>
      {/* One tag for role and mode (green = live, red = stopped) keeps the header on one row next to the existing actions. */}
      <Tag type={mode === Mode.STOPPED ? 'red' : 'green'} size="sm" title="Live view">
        {`${operator ? 'Operator' : 'Viewer'} · ${MODE_LABEL[mode]}`}
      </Tag>
      {!operator && session && !session.operatorId && (
        <Button kind="tertiary" size="md" onClick={() => client.takeControl()}>
          Take control
        </Button>
      )}
      {stop}
    </>
  )
}
