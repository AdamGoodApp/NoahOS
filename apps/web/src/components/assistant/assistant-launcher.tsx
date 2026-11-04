import { Chat } from '@carbon/icons-react'
import { useLocation } from '@tanstack/react-router'

import { openAssistant, useAssistantOpen } from '@/lib/agent/assistant-store'
import { pageContextFor } from '@/lib/agent/page-context'

/** Floating "Ask NoahOS" button outside /app (there the UI Shell header has the Assistant action). */
export function AssistantLauncher() {
  const open = useAssistantOpen()
  const { page } = pageContextFor(useLocation({ select: (l) => l.pathname }))
  if (open || page === 'fleet' || page === 'control') return null
  return (
    <button type="button" className="assistant-launcher" data-assistant-toggle="" onClick={openAssistant}>
      <Chat size={20} aria-hidden="true" />
      Ask NoahOS
    </button>
  )
}
