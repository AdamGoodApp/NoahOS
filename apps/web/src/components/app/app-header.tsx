import {
  Header,
  HeaderGlobalAction,
  HeaderGlobalBar,
  HeaderMenuItem,
  HeaderName,
  HeaderNavigation,
  HeaderPanel,
  SkipToContent,
  Switcher,
  SwitcherDivider,
  SwitcherItem,
} from '@carbon/react'
import { Chat, UserAvatar } from '@carbon/icons-react'
import { useLocation, useNavigate, useRouteContext } from '@tanstack/react-router'
import { useState, type ReactNode, type SyntheticEvent } from 'react'

import { closeAssistant, toggleAssistant, useAssistantOpen } from '@/lib/agent/assistant-store'
import { authClient } from '@/lib/auth-client'

/** False for modified or non-primary clicks, so the browser can open the link in a new tab or window. */
export function isPlainClick(e: SyntheticEvent): boolean {
  const m = e.nativeEvent as Partial<MouseEvent>
  return !(m.metaKey || m.ctrlKey || m.shiftKey || m.altKey || (m.button !== undefined && m.button !== 0))
}

/** UI Shell header shared by every `/app` page. `actions` render before the account avatar, which opens the account panel. */
export function AppHeader({ skipTo, actions }: { skipTo: string; actions?: ReactNode }) {
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const { user } = useRouteContext({ from: '/app' })
  const [accountOpen, setAccountOpen] = useState(false)
  const assistantOpen = useAssistantOpen()
  return (
    <Header aria-label="NoahOS">
      <SkipToContent href={skipTo} />
      <HeaderName href="/" prefix="">
        <span className="fleet-brand">
          NoahOS
        </span>
      </HeaderName>
      <HeaderNavigation aria-label="NoahOS">
        <HeaderMenuItem
          href="/app"
          isCurrentPage={pathname === '/app' || pathname === '/app/'}
          onClick={(e: SyntheticEvent) => {
            if (!isPlainClick(e)) return
            e.preventDefault()
            navigate({ to: '/app' })
          }}
        >
          Dashboard
        </HeaderMenuItem>
      </HeaderNavigation>
      <HeaderGlobalBar>
        {actions}
        <HeaderGlobalAction
          aria-label="Assistant"
          data-assistant-toggle=""
          tooltipAlignment="end"
          isActive={assistantOpen}
          onClick={() => {
            setAccountOpen(false)
            toggleAssistant()
          }}
        >
          <Chat size={20} />
        </HeaderGlobalAction>
        <HeaderGlobalAction
          aria-label={`Account: ${user.name}`}
          tooltipAlignment="end"
          isActive={accountOpen}
          onClick={() => {
            closeAssistant()
            setAccountOpen((o) => !o)
          }}
        >
          <UserAvatar size={20} />
        </HeaderGlobalAction>
      </HeaderGlobalBar>
      <HeaderPanel aria-label="Account" expanded={accountOpen}>
        <Switcher aria-label="Account" expanded={accountOpen}>
          <li className="auth-account">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </li>
          <SwitcherDivider />
          <SwitcherItem
            aria-label="Sign out"
            href="/"
            onClick={(e: SyntheticEvent) => {
              e.preventDefault()
              void authClient.signOut().then(() => navigate({ to: '/' }))
            }}
          >
            Sign out
          </SwitcherItem>
        </Switcher>
      </HeaderPanel>
    </Header>
  )
}
