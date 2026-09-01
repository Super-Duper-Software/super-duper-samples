// The small "signed in as X / Sign out" area in the header. When signed out it
// is just a compact "Sign in" button — the reason to sign in is spelled out by
// <SignInGate/>, which replaces the Search view until the user is signed in
// (ADR-0004). This button stays reachable from the Library / Collections tabs.

import { useAuth } from '../hooks/useAuth'

export function AuthBar() {
  const { state, busy, signIn, signOut, error } = useAuth()

  if (state.status === 'signedIn') {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <span>
          Signed in as{' '}
          <span className="font-medium text-ink">{state.username}</span>
        </span>
        <button
          type="button"
          onClick={signOut}
          className="rounded border border-line px-2 py-0.5 text-ink-muted hover:bg-surface-raised"
        >
          Sign out
        </button>
      </div>
    )
  }

  const signingIn = busy || state.status === 'signingIn'

  return (
    <div className="flex items-center gap-2 text-xs">
      {state.reauthRequired && (
        <span className="text-ink-faint">Session expired.</span>
      )}
      <button
        type="button"
        onClick={signIn}
        disabled={signingIn}
        className="rounded border border-accent-2 px-2 py-0.5 text-accent-2-text hover:bg-surface-raised disabled:opacity-50"
      >
        {signingIn
          ? 'Signing in…'
          : state.reauthRequired
            ? 'Sign in again'
            : 'Sign in'}
      </button>
      {error && (
        <span className="text-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
