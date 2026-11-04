import { Theme } from '@carbon/react'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { appHeadLinks } from '@/lib/app-head'
import { getSessionUser } from '@/server/auth.functions'

export const Route = createFileRoute('/app')({
  // Signed-out visitors go to sign-in and come back here afterwards.
  beforeLoad: async ({ location }) => {
    const user = await getSessionUser()
    if (!user) throw redirect({ to: '/auth/sign-in', search: { redirect: location.href } })
    return { user }
  },
  head: () => ({ links: appHeadLinks }),
  component: () => (
    <Theme theme="white">
      <Outlet />
    </Theme>
  ),
})
