import { useHydrated } from '@tanstack/react-router'
import { useState } from 'react'

/**
 * Pending state for an auth request, plus the disabled flag for its submit button.
 * Submit is disabled until hydration: a pre-hydration click would do a native GET and drop the fields and `?redirect=`.
 */
export function useSubmitGate() {
  const [pending, setPending] = useState(false)
  const hydrated = useHydrated()

  async function run<T>(request: () => Promise<T>): Promise<T> {
    setPending(true)
    try {
      return await request()
    } finally {
      setPending(false)
    }
  }

  return { pending, disabled: pending || !hydrated, run }
}
