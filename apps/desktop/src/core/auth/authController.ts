import { randomBytes } from 'node:crypto'
import { GatewayError } from '../errors'
import type { DB } from '../db/index'
import type { FreesoundGateway, TokenSet } from '../gateway/index'
import type { AuthPlatform } from './platform'
import type { Scheduler } from './scheduler'
import {
  LoopbackPortInUseError,
  OAuthStateMismatchError,
  ReauthRequiredError,
  RetryableTokenError,
  SignInCancelledError,
} from './errors'
import {
  clearStoredAuth,
  readStoredAuth,
  writeStoredAuth,
  type PersistedSession,
} from './store'

export type AuthStatus = 'signedOut' | 'signingIn' | 'signedIn'

/**
 * The auth state the renderer reads (via `getAuthState()` and the change
 * subscription). Deliberately holds NO access token — that stays in the core's
 * memory only.
 */
export interface AuthState {
  status: AuthStatus
  /** Freesound username once known; `null` otherwise. */
  username: string | null
  /**
   * The last refresh failed unrecoverably (the grant is dead). The renderer
   * shows a one-click "Sign in again" prompt. Cleared by a successful sign-in.
   */
  reauthRequired: boolean
}

const FREESOUND_AUTHORIZE_URL = 'https://freesound.org/apiv2/oauth2/authorize/'
export const LOOPBACK_PORT = 8910
const CALLBACK_PATH = '/callback'
export const REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}${CALLBACK_PATH}`

const DEFAULT_REFRESH_MARGIN_MS = 5 * 60_000
const DEFAULT_TRANSIENT_RETRY_MS = 60_000
const DEFAULT_SIGN_IN_TIMEOUT_MS = 3 * 60_000
const CLOCK_SKEW_MS = 30_000

export interface AuthControllerDeps {
  gateway: Pick<FreesoundGateway, 'exchangeToken' | 'refreshToken' | 'getMe'>
  platform: AuthPlatform
  scheduler: Scheduler
  db: DB
  /** `FREESOUND_CLIENT_ID` (public). `client_secret` lives only in the Worker. */
  clientId: string
  /** Called on every state transition (main broadcasts it to the renderer). */
  onStateChange?: (state: AuthState) => void

  /** Override the CSRF `state` generator. */
  generateState?: () => string
  refreshMarginMs?: number
  transientRetryMs?: number
  signInTimeoutMs?: number
}

export interface AuthController {
  /**
   * Open the system browser at Freesound's authorize page, catch the code on the
   * one-shot loopback listener, exchange it via the Worker, fetch the username,
   * store the (encrypted) refresh token, and schedule proactive refresh.
   * Rejects with `LoopbackPortInUseError`, `OAuthStateMismatchError`,
   * `SignInCancelledError`, `ReauthRequiredError`, … and leaves state `signedOut`.
   */
  signIn(): Promise<AuthState>
  /** Clear the stored tokens. Leaves the Library and every downloaded file intact. */
  signOut(): Promise<void>
  getState(): AuthState
  subscribe(listener: (state: AuthState) => void): () => void
  /**
   * Run an authenticated Freesound call with a valid access token. On a 401,
   * does EXACTLY one refresh and EXACTLY one retry — never a loop. A dead refresh
   * (or a still-401 retry) transitions to `signedOut` + `reauthRequired`.
   * Search/preview are token-auth and must NOT go through here.
   */
  authorized<T>(call: (accessToken: string) => Promise<T>): Promise<T>
  /** Cancel any pending timer. Call from `core.close()`. */
  close(): void
}

function defaultGenerateState(): string {
  return randomBytes(16).toString('hex')
}

function isUnauthorized(err: unknown): boolean {
  return err instanceof GatewayError && err.status === 401
}

function isAddrInUse(err: unknown): boolean {
  return (
    err instanceof LoopbackPortInUseError ||
    (!!err &&
      typeof err === 'object' &&
      (err as { code?: unknown }).code === 'EADDRINUSE')
  )
}

export function createAuthController(deps: AuthControllerDeps): AuthController {
  const {
    gateway,
    platform,
    scheduler,
    db,
    clientId,
    onStateChange,
    generateState = defaultGenerateState,
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

  let accessToken: string | null = null
  let accessTokenExpiresAt = 0
  let refreshToken: string | null = null
  let username: string | null = null

  let cancelRefreshTimer: (() => void) | null = null
  let inFlightRefresh: Promise<string> | null = null

  function setState(next: AuthState): void {
    state = next
    for (const l of listeners) l(next)
    onStateChange?.(next)
  }

  function adoptTokens(t: TokenSet): void {
    accessToken = t.accessToken
    refreshToken = t.refreshToken
    accessTokenExpiresAt = scheduler.now() + t.expiresIn * 1000
  }

  function persist(): void {
    if (!refreshToken) return
    const blob = platform.encrypt(
      Buffer.from(
        JSON.stringify({
          refreshToken,
          username: username ?? '',
        } satisfies PersistedSession),
        'utf8',
      ),
    )
    writeStoredAuth(db, {
      refreshTokenEnc: blob,
      accessTokenExpires: accessTokenExpiresAt,
    })
  }

  /** Wipe every trace of the session. Only touches the `auth` row on disk. */
  function hardSignOut(reauthRequired: boolean): void {
    if (cancelRefreshTimer) {
      cancelRefreshTimer()
      cancelRefreshTimer = null
    }
    accessToken = null
    accessTokenExpiresAt = 0
    refreshToken = null
    username = null
    clearStoredAuth(db)
    setState({ status: 'signedOut', username: null, reauthRequired })
  }

  function scheduleProactiveRefresh(): void {
    if (cancelRefreshTimer) {
      cancelRefreshTimer()
      cancelRefreshTimer = null
    }
    if (!refreshToken) return
    const delay = Math.max(
      0,
      accessTokenExpiresAt - scheduler.now() - refreshMarginMs,
    )
    cancelRefreshTimer = scheduler.schedule(() => {
      cancelRefreshTimer = null
      void doRefresh().catch((err: unknown) => {
        if (err instanceof RetryableTokenError) {
          if (cancelRefreshTimer) cancelRefreshTimer()
          cancelRefreshTimer = scheduler.schedule(() => {
            cancelRefreshTimer = null
            void doRefresh().catch(() => {})
          }, transientRetryMs)
        }
        // ReauthRequiredError is already terminal — doRefresh() called
        // hardSignOut(true). Nothing to reschedule.
      })
    }, delay)
  }

  /**
   * Single-flight refresh. Concurrent callers (the proactive timer and a 401
   * interceptor firing at the same moment) share one Worker round-trip.
   */
  function doRefresh(): Promise<string> {
    if (inFlightRefresh) return inFlightRefresh
    inFlightRefresh = (async () => {
      if (!refreshToken) {
        hardSignOut(true)
        throw new ReauthRequiredError('no stored refresh token')
      }
      let tokens: TokenSet
      try {
        tokens = await gateway.refreshToken(refreshToken)
      } catch (err) {
        if (err instanceof ReauthRequiredError) {
          hardSignOut(true)
        }
        throw err
      }
      adoptTokens(tokens)
      persist()
      if (state.status !== 'signedIn') {
        setState({ status: 'signedIn', username, reauthRequired: false })
      }
      scheduleProactiveRefresh()
      return tokens.accessToken
    })().finally(() => {
      inFlightRefresh = null
    })
    return inFlightRefresh
  }

  async function getValidAccessToken(): Promise<string> {
    if (accessToken && scheduler.now() < accessTokenExpiresAt - CLOCK_SKEW_MS) {
      return accessToken
    }
    return doRefresh()
  }

  async function authorized<T>(
    call: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const token = await getValidAccessToken()
    try {
      return await call(token)
    } catch (err) {
      if (!isUnauthorized(err)) throw err

      const retryToken = await doRefresh()

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

    const authorizeUrl = new URL(FREESOUND_AUTHORIZE_URL)
    authorizeUrl.searchParams.set('client_id', clientId)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('state', expectedState)

    const abort = new AbortController()
    const cancelTimeout = scheduler.schedule(
      () => abort.abort(),
      signInTimeoutMs,
    )

    let result
    try {
      const pending = platform.awaitLoopbackCode({
        port: LOOPBACK_PORT,
        path: CALLBACK_PATH,
        signal: abort.signal,
      })
      await platform.openExternal(authorizeUrl.toString())
      result = await pending
    } catch (err) {
      cancelTimeout()
      setState({ status: 'signedOut', username: null, reauthRequired: false })
      if (isAddrInUse(err)) throw new LoopbackPortInUseError(LOOPBACK_PORT)
      throw err
    }
    cancelTimeout()

    try {
      if (result.error || !result.code) {
        throw new SignInCancelledError(result.error)
      }
      if (result.state !== expectedState) {
        throw new OAuthStateMismatchError()
      }

      adoptTokens(await gateway.exchangeToken(result.code, REDIRECT_URI))

      const me = await authorized((t) => gateway.getMe(t))
      username = me.username || null

      persist()
      setState({ status: 'signedIn', username, reauthRequired: false })
      scheduleProactiveRefresh()
      return state
    } catch (err) {
      hardSignOut(false)
      throw err
    }
  }

  async function signOut(): Promise<void> {
    hardSignOut(false)
  }

  ;(function restoreSession(): void {
    const row = readStoredAuth(db)
    if (!row) return
    let session: PersistedSession
    try {
      session = JSON.parse(
        platform.decrypt(row.refreshTokenEnc).toString('utf8'),
      ) as PersistedSession
    } catch {
      clearStoredAuth(db)
      return
    }
    if (!session.refreshToken) {
      clearStoredAuth(db)
      return
    }
    refreshToken = session.refreshToken
    username = session.username || null
    accessToken = null
    accessTokenExpiresAt = row.accessTokenExpires ?? 0
    setState({ status: 'signedIn', username, reauthRequired: false })
    scheduleProactiveRefresh()
  })()

  return {
    signIn,
    signOut,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    authorized,
    close() {
      if (cancelRefreshTimer) {
        cancelRefreshTimer()
        cancelRefreshTimer = null
      }
    },
  }
}
