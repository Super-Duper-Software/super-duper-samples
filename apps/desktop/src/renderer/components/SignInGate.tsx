// The gate shown in place of the Search view until the user signs in. ADR-0004:
// the app bundles no Freesound API key, so search runs on the user's OAuth
// bearer token — there is no anonymous search. The Library and Collections tabs
// stay reachable behind this (they are local-only), so this only replaces the
// search pane, not the whole window.

import { useAuth } from '../hooks/useAuth'

export function SignInGate() {
  const { state, busy, signIn, error } = useAuth()
  const signingIn = busy || state.status === 'signingIn'

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h2 className="text-base font-semibold text-ink">
          Sign in to search Freesound
        </h2>
        <p className="mt-2 text-sm text-ink-muted">
          {state.reauthRequired
            ? 'Your Freesound session expired. Sign in again to search, download, and drag sounds out.'
            : 'Searching, downloading, and dragging sounds out all happen as your Freesound account. Your Library and Collections stay available without signing in.'}
        </p>
        <button
          type="button"
          onClick={signIn}
          disabled={signingIn}
          className="mt-4 rounded border border-accent-2 px-3 py-1.5 text-sm text-accent-2-text hover:bg-surface-raised disabled:opacity-50"
        >
          {signingIn
            ? 'Signing in…'
            : state.reauthRequired
              ? 'Sign in again'
              : 'Sign in with Freesound'}
        </button>
        {error && (
          <p className="mt-3 text-xs text-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
