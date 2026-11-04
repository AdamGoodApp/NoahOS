import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

// A fresh router per request keeps SSR state isolated between requests.
export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
