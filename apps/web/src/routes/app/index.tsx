import { createFileRoute } from '@tanstack/react-router'

import { FleetDashboard } from '@/components/app/fleet-dashboard'

export const Route = createFileRoute('/app/')({
  head: () => ({ meta: [{ title: 'Dashboard · NoahOS' }] }),
  component: FleetDashboard,
})
