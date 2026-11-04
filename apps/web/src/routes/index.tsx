import { createFileRoute, redirect } from '@tanstack/react-router'

/** The console is the product: the site root opens the fleet dashboard (sign-in first when signed out). */
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/app' })
  },
})
