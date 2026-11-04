import { Button, ContainedList, ContainedListItem, Tag } from '@carbon/react'
import { Pause, Play } from '@carbon/icons-react'

import { Mode, type Welcome } from '@/gen/noahos/sim/v1/sim_pb'
import type { LiveClient, LiveState } from '@/lib/live/client'

/**
 * The robot's policies (Welcome.policies): the operator plays one, or pauses the playing one (Manual hold holds the
 * pose). Viewers see which one is playing.
 */
export function PolicyPanel({
  welcome,
  live,
  client,
  operator,
}: {
  welcome: Welcome | null
  live: LiveState
  client: LiveClient
  operator: boolean
}) {
  return (
    <>
      <ContainedList label="Policies" size="sm">
        {!welcome ? (
          <ContainedListItem>Go live to list this robot's policies</ContainedListItem>
        ) : (
          welcome.policies.map((p) => {
            const playing = live.mode === Mode.AUTO && live.policy === p.id
            return (
              <ContainedListItem
                key={p.id}
                action={
                  <Button
                    kind="ghost"
                    size="sm"
                    renderIcon={playing ? Pause : Play}
                    disabled={!operator}
                    onClick={() => (playing ? client.hold() : client.play(p.id))}
                  >
                    {playing ? 'Pause' : 'Play'}
                  </Button>
                }
              >
                <span className="control-policy__title">
                  {p.name}
                  {playing && (
                    <Tag type="green" size="sm">
                      Playing
                    </Tag>
                  )}
                </span>
                <span className="control-policy__description">{p.description}</span>
              </ContainedListItem>
            )
          })
        )}
      </ContainedList>
      {welcome && !operator && <p className="control-empty">Viewing: only the operator can play policies.</p>}
    </>
  )
}
