// The small "signed in as X" identity area in the header. When signed out it is
// just a compact "Sign in" button — the reason to sign in is spelled out by
// <SignInGate/>, which replaces the Search view until the user is signed in
// (ADR-0004). This button stays reachable from the Library / Collections tabs.
//
// Sign out is no longer a bare button here — spec 0003 moves it into the header
// `⋯` overflow menu (App.tsx) in both layouts. When signed in this component is
// only the username label: it truncates rather than pushing the wide header to a
// second row, and drops the "Signed in as" prefix below ~820px so the name still
// shows but costs less width.

import { useAuth } from '../hooks/useAuth'

export function AuthBar() {
  const { state, busy, signIn, error } = useAuth()

  if (state.status === 'signedIn') {
    return (
      <div className="flex min-w-0 items-center text-xs text-ink-muted">
        <span className="min-w-0 truncate">
          <span className="max-[820px]:hidden">Signed in as </span>
          <span className="font-medium text-ink">{state.username}</span>
        </span>
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
