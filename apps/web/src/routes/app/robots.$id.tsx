import { Button, InlineNotification } from '@carbon/react'
import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'

import { AppHeader } from '@/components/app/app-header'
import { ControlPage } from '@/components/app/control-page'
import { FLEET } from '@/components/app/fleet-data'

export const Route = createFileRoute('/app/robots/$id')({
  // `?pair=<token>`: opened from the visionOS app, which holds the operator lock with the same token.
  validateSearch: (s: Record<string, unknown>): { pair?: string } => ({
    pair: typeof s.pair === 'string' && /^[\w-]{16,64}$/.test(s.pair) ? s.pair : undefined,
  }),
  // A new robot gets a fresh Control page: model, history and live link never carry over between robots.
  remountDeps: ({ params }) => params.id,
  loader: ({ params }) => {
    const robot = FLEET.find((r) => r.id === params.id)
    if (!robot) throw notFound()
    return robot
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.name ?? 'Robot'} · Control · NoahOS` }] }),
  component: () => <ControlPage robot={Route.useLoaderData()} pairToken={Route.useSearch().pair} />,
  notFoundComponent: RobotNotFound,
})

function RobotNotFound() {
  const navigate = useNavigate()
  return (
    <>
      <AppHeader skipTo="#robot-missing" />
      <main id="robot-missing" className="control-missing" tabIndex={-1}>
        <InlineNotification
          kind="error"
          lowContrast
          hideCloseButton
          title="Robot not found"
          subtitle="This robot is not in the fleet."
        />
        <Button kind="tertiary" onClick={() => navigate({ to: '/app' })}>
          Back to dashboard
        </Button>
      </main>
    </>
  )
}
