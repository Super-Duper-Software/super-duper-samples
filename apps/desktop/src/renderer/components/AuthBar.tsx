// The small "signed in as X / Sign out" area, plus the signed-out hint that
// downloading and dragging need sign-in (requirement 12 — the actual gating is
// tickets 08/09; this only surfaces the state).

import { useAuth } from '../hooks/useAuth'

export function AuthBar() {
  const { state, busy, signIn, signOut, error } = useAuth()

  if (state.status === 'signedIn') {
    return (
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <span>
          Signed in as{' '}
          <span className="font-medium text-neutral-200">{state.username}</span>
        </span>
        <button
          type="button"
          onClick={signOut}
          className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:bg-neutral-800"
        >
          Sign out
        </button>
      </div>
    )
  }

  const signingIn = busy || state.status === 'signingIn'

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-neutral-500">
        {state.reauthRequired
          ? 'Your session expired — sign in again to download & drag.'
          : 'Sign in to download & drag.'}
      </span>
      <button
        type="button"
        onClick={signIn}
        disabled={signingIn}
        className="rounded border border-emerald-700 px-2 py-0.5 text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-50"
      >
        {signingIn
          ? 'Signing in…'
          : state.reauthRequired
            ? 'Sign in again'
            : 'Sign in'}
      </button>
      {error && (
        <span className="text-red-400" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
