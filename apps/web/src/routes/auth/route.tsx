import { Theme } from '@carbon/react'
import { createFileRoute, Outlet } from '@tanstack/react-router'

import { appHeadLinks } from '@/lib/app-head'

export const Route = createFileRoute('/auth')({
  head: () => ({ links: appHeadLinks }),
  component: () => (
    <Theme theme="white">
      <Outlet />
    </Theme>
  ),
})
