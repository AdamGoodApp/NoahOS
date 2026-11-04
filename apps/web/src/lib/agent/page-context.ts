export type PageKind = 'fleet' | 'control' | 'auth' | 'other'

export type PageContext = { page: PageKind; path: string; robotId?: string }

/** Which product page a pathname is. */
export function pageContextFor(pathname: string): PageContext {
  const path = pathname || '/'
  if (path === '/app' || path === '/app/') return { page: 'fleet', path }
  const robot = /^\/app\/robots\/([^/]+)\/?$/.exec(path)?.[1]
  if (robot) {
    let robotId = robot
    try {
      robotId = decodeURIComponent(robotId)
    } catch {
      // Malformed escape: keep the raw segment.
    }
    return { page: 'control', path, robotId }
  }
  if (path === '/auth' || path.startsWith('/auth/')) return { page: 'auth', path }
  return { page: 'other', path }
}

const PAGE_NAMES: Record<PageKind, string> = {
  fleet: 'fleet dashboard',
  control: 'Control',
  auth: 'sign-in',
  other: 'other',
}

function shortString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : undefined
}

/** System-prompt line about the user's current page, from the request's forwardedProps (untrusted). */
export function describePage(forwardedProps: Record<string, unknown> | undefined): string {
  const page = shortString(forwardedProps?.page)
  const path = shortString(forwardedProps?.path)
  const robotId = shortString(forwardedProps?.robotId)
  if (!page || !path || !(page in PAGE_NAMES)) return "The user's current page is unknown."
  if (page === 'control' && robotId) return `The user is currently on the Control page of robot ${robotId} (${path}).`
  return `The user is currently on the ${PAGE_NAMES[page as PageKind]} page (${path}).`
}
