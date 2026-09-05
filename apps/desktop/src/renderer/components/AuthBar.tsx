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
