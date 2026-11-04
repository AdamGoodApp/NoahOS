import { useSyncExternalStore } from 'react'

/** Whether the assistant panel is open; shared by the panel, the header action and the launcher. */
let open = false
const listeners = new Set<() => void>()

function set(next: boolean) {
  if (next === open) return
  open = next
  for (const l of listeners) l()
}

export const openAssistant = () => set(true)
export const closeAssistant = () => set(false)
export const toggleAssistant = () => set(!open)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAssistantOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
}
