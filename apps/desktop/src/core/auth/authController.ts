import { GatewayError } from '../errors'
import type { DB } from '../db/index'
import type { FreesoundGateway } from '../gateway/index'
import type { AuthPlatform } from './platform'
import type { Scheduler } from './scheduler'
import {
  assertStateMatches,
  authorizationCodeFrom,
  generateOAuthState,
  runBrowserStep,
  REDIRECT_URI,
} from './signInFlow'
import { createTokenSession } from './tokenSession'

export { LOOPBACK_PORT, REDIRECT_URI } from './signInFlow'

export type AuthStatus = 'signedOut' | 'signingIn' | 'signedIn'

/** The auth state the renderer reads. Deliberately holds NO access token. */
export interface AuthState {
  status: AuthStatus
  username: string | null
  /** The grant is dead; the renderer shows a one-click "Sign in again" prompt. */
  reauthRequired: boolean
}

const DEFAULT_REFRESH_MARGIN_MS = 5 * 60_000
const DEFAULT_TRANSIENT_RETRY_MS = 60_000
const DEFAULT_SIGN_IN_TIMEOUT_MS = 3 * 60_000

export interface AuthControllerDeps {
  gateway: Pick<FreesoundGateway, 'exchangeToken' | 'refreshToken' | 'getMe'>
  platform: AuthPlatform
  scheduler: Scheduler
  db: DB
  /** `FREESOUND_CLIENT_ID` (public). `client_secret` lives only in the Worker. */
  clientId: string
  onStateChange?: (state: AuthState) => void

  /** Override the CSRF `state` generator. */
  generateState?: () => string
  refreshMarginMs?: number
  transientRetryMs?: number
  signInTimeoutMs?: number
}

export interface AuthController {
  /**
   * Run the full OAuth sign-in through the system browser. Rejects with
   * `LoopbackPortInUseError`, `OAuthStateMismatchError`, `SignInCancelledError`
   * or `ReauthRequiredError`, leaving the state `signedOut`.
   */
  signIn(): Promise<AuthState>
  /** Clear the stored tokens. Leaves the Library and every downloaded file intact. */
  signOut(): Promise<void>
  getState(): AuthState
  subscribe(listener: (state: AuthState) => void): () => void
  /**
   * Run an authenticated Freesound call with a valid access token. On a 401,
   * does EXACTLY one refresh and EXACTLY one retry — never a loop. Search and
   * preview are token-auth and must NOT go through here.
   */
  authorized<T>(call: (accessToken: string) => Promise<T>): Promise<T>
  /** Cancel any pending timer. Call from `core.close()`. */
  close(): void
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof GatewayError && err.status === 401
}

export function createAuthController(deps: AuthControllerDeps): AuthController {
  const {
    gateway,
    platform,
    scheduler,
    db,
    clientId,
    onStateChange,
    generateState = generateOAuthState,
    refreshMarginMs = DEFAULT_REFRESH_MARGIN_MS,
    transientRetryMs = DEFAULT_TRANSIENT_RETRY_MS,
    signInTimeoutMs = DEFAULT_SIGN_IN_TIMEOUT_MS,
  } = deps

  let state: AuthState = {
    status: 'signedOut',
    username: null,
    reauthRequired: false,
  }
  const listeners = new Set<(s: AuthState) => void>()

  function setState(next: AuthState): void {
    state = next
    for (const l of listeners) l(next)
    onStateChange?.(next)
  }

  function signedOut(reauthRequired: boolean): void {
    setState({ status: 'signedOut', username: null, reauthRequired })
  }

  const session = createTokenSession({
    db,
    platform,
    scheduler,
    refresh: (token) => gateway.refreshToken(token),
    refreshMarginMs,
    transientRetryMs,
    onRefreshed: (username) => {
      if (state.status !== 'signedIn') {
        setState({ status: 'signedIn', username, reauthRequired: false })
      }
    },
    onDead: () => signedOut(true),
  })

  /** Wipe every trace of the session. Only touches the `auth` row on disk. */
  function hardSignOut(reauthRequired: boolean): void {
    session.clear()
    signedOut(reauthRequired)
  }

  async function authorized<T>(
    call: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const token = await session.validAccessToken()
    try {
      return await call(token)
    } catch (err) {
      if (!isUnauthorized(err)) throw err
      const retryToken = await session.refreshNow()
      try {
        return await call(retryToken)
      } catch (retryErr) {
        if (isUnauthorized(retryErr)) hardSignOut(true)
        throw retryErr
      }
    }
  }

  async function signIn(): Promise<AuthState> {
    if (state.status === 'signingIn') {
      throw new Error('A sign-in is already in progress.')
    }

    const expectedState = generateState()
    setState({ status: 'signingIn', username: null, reauthRequired: false })

    let callback
    try {
      callback = await runBrowserStep({
        platform,
        scheduler,
        clientId,
        expectedState,
        timeoutMs: signInTimeoutMs,
      })
    } catch (err) {
      // The browser step never got as far as a grant, so any stored session
      // stays valid — only the transient `signingIn` state is rolled back.
      signedOut(false)
      throw err
    }

    try {
      const code = authorizationCodeFrom(callback)
      assertStateMatches(callback, expectedState)

      session.adopt(await gateway.exchangeToken(code, REDIRECT_URI))
      const me = await authorized((t) => gateway.getMe(t))
      session.setUsername(me.username || null)
      session.commit()

      setState({
        status: 'signedIn',
        username: session.username,
        reauthRequired: false,
      })
      return state
    } catch (err) {
      hardSignOut(false)
      throw err
    }
  }

  if (session.restore()) {
    setState({
      status: 'signedIn',
      username: session.username,
      reauthRequired: false,
    })
    session.startRefreshTimer()
  }

  return {
    signIn,
    signOut: async () => hardSignOut(false),
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    authorized,
    close: () => session.clearTimer(),
  }
}
