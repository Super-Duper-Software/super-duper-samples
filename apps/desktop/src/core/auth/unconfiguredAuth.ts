import type { AuthController, AuthState } from './index'

/**
 * Stand-in when the core is built without an `AuthPlatform`. Its state stays
 * `signedOut`, so a search rejects with `NotSignedInError` before it could ever
 * reach `authorized()` here — there is no token-auth fallback.
 */
export function unconfiguredAuth(
  onStateChange?: (s: AuthState) => void,
): AuthController {
  const state: AuthState = {
    status: 'signedOut',
    username: null,
    reauthRequired: false,
  }
  const notConfigured = () =>
    Promise.reject(
      new Error(
        'Authentication is not configured (missing AuthPlatform / FREESOUND_CLIENT_ID).',
      ),
    )
  onStateChange?.(state)
  return {
    signIn: notConfigured as AuthController['signIn'],
    signOut: () => Promise.resolve(),
    getState: () => state,
    subscribe: () => () => {},
    authorized: notConfigured as AuthController['authorized'],
    close: () => {},
  }
}
