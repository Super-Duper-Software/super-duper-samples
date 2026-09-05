import { useCallback, useEffect, useState } from 'react'
import type { AuthState } from '../../preload'

const INITIAL: AuthState = {
  status: 'signedOut',
  username: null,
  reauthRequired: false,
}

export interface UseAuth {
  state: AuthState
  /** True while a browser sign-in round-trip is in progress. */
  busy: boolean
  signIn: () => void
  signOut: () => void
  /** Last sign-in error message, if the most recent attempt failed. */
  error: string | null
}

export function useAuth(): UseAuth {
  const [state, setState] = useState<AuthState>(INITIAL)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void window.core.getAuthState().then((s) => {
      if (alive) setState(s)
    })
    const unsubscribe = window.core.onAuthState((s) => {
      if (alive) setState(s)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  const signIn = useCallback(() => {
    setBusy(true)
    setError(null)
    window.core
      .signIn()
      .then((s) => setState(s))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setBusy(false))
  }, [])

  const signOut = useCallback(() => {
    setError(null)
    void window.core.signOut()
  }, [])

  return { state, busy, signIn, signOut, error }
}
