import type { DB } from '../db/index'
import type { TokenSet } from '../gateway/index'
import type { AuthPlatform } from './platform'
import type { Scheduler } from './scheduler'
import { ReauthRequiredError, RetryableTokenError } from './errors'
import {
  clearStoredAuth,
  readStoredAuth,
  writeStoredAuth,
  type PersistedSession,
} from './store'

const CLOCK_SKEW_MS = 30_000

export interface TokenSessionDeps {
  db: DB
  platform: AuthPlatform
  scheduler: Scheduler
  /** Exchanges a refresh token for a fresh `TokenSet` via the token Worker. */
  refresh: (refreshToken: string) => Promise<TokenSet>
  /** How far ahead of expiry the proactive refresh timer fires. */
  refreshMarginMs: number
  /** Backoff before retrying a refresh that failed transiently. */
  transientRetryMs: number
  /** A refresh produced a usable token; the session is (still) signed in. */
  onRefreshed: (username: string | null) => void
  /** The grant is dead. Every trace of the session has already been wiped. */
  onDead: () => void
}

/**
 * Holds the live OAuth tokens and keeps them fresh. The access token never
 * leaves this module's closure; nothing about it reaches the renderer.
 */
export interface TokenSession {
  /** Restore the encrypted refresh token from disk. True when a session was found. */
  restore(): boolean
  /** Adopt a freshly exchanged token set. Nothing is written until `commit`. */
  adopt(tokens: TokenSet): void
  /** Persist the session (encrypted) and start the proactive refresh timer. */
  commit(): void
  /** Start (or restart) the proactive refresh timer without writing anything. */
  startRefreshTimer(): void
  /** Cancel the pending refresh timer, keeping the tokens. */
  clearTimer(): void
  /** A valid access token, refreshing first if the current one is near expiry. */
  validAccessToken(): Promise<string>
  /** Force a refresh now, sharing one round-trip with any concurrent caller. */
  refreshNow(): Promise<string>
  readonly username: string | null
  setUsername(username: string | null): void
  /** Wipe tokens, timer and the stored `auth` row. */
  clear(): void
}

export function createTokenSession(deps: TokenSessionDeps): TokenSession {
  const { db, platform, scheduler } = deps

  let accessToken: string | null = null
  let accessTokenExpiresAt = 0
  let refreshToken: string | null = null
  let username: string | null = null

  let cancelTimer: (() => void) | null = null
  let inFlight: Promise<string> | null = null

  function stopTimer(): void {
    if (!cancelTimer) return
    cancelTimer()
    cancelTimer = null
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

  function clear(): void {
    stopTimer()
    accessToken = null
    accessTokenExpiresAt = 0
    refreshToken = null
    username = null
    clearStoredAuth(db)
  }

  function scheduleProactiveRefresh(): void {
    stopTimer()
    if (!refreshToken) return
    const delay = Math.max(
      0,
      accessTokenExpiresAt - scheduler.now() - deps.refreshMarginMs,
    )
    cancelTimer = scheduler.schedule(() => {
      cancelTimer = null
      void refreshNow().catch((err: unknown) => {
        // A dead grant is terminal (refreshNow already reported it); only a
        // transient failure earns another attempt.
        if (!(err instanceof RetryableTokenError)) return
        stopTimer()
        cancelTimer = scheduler.schedule(() => {
          cancelTimer = null
          void refreshNow().catch(() => {})
        }, deps.transientRetryMs)
      })
    }, delay)
  }

  /** Single-flight: the proactive timer and a 401 interceptor share one round-trip. */
  function refreshNow(): Promise<string> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      if (!refreshToken) {
        clear()
        deps.onDead()
        throw new ReauthRequiredError('no stored refresh token')
      }
      let tokens: TokenSet
      try {
        tokens = await deps.refresh(refreshToken)
      } catch (err) {
        if (err instanceof ReauthRequiredError) {
          clear()
          deps.onDead()
        }
        throw err
      }
      accessToken = tokens.accessToken
      refreshToken = tokens.refreshToken
      accessTokenExpiresAt = scheduler.now() + tokens.expiresIn * 1000
      persist()
      deps.onRefreshed(username)
      scheduleProactiveRefresh()
      return tokens.accessToken
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    restore() {
      const row = readStoredAuth(db)
      if (!row) return false
      let session: PersistedSession
      try {
        session = JSON.parse(
          platform.decrypt(row.refreshTokenEnc).toString('utf8'),
        ) as PersistedSession
      } catch {
        clearStoredAuth(db)
        return false
      }
      if (!session.refreshToken) {
        clearStoredAuth(db)
        return false
      }
      refreshToken = session.refreshToken
      username = session.username || null
      accessToken = null
      accessTokenExpiresAt = row.accessTokenExpires ?? 0
      return true
    },

    adopt(tokens) {
      accessToken = tokens.accessToken
      refreshToken = tokens.refreshToken
      accessTokenExpiresAt = scheduler.now() + tokens.expiresIn * 1000
    },

    commit() {
      persist()
      scheduleProactiveRefresh()
    },

    startRefreshTimer: scheduleProactiveRefresh,
    clearTimer: stopTimer,

    async validAccessToken() {
      if (accessToken && scheduler.now() < accessTokenExpiresAt - CLOCK_SKEW_MS) {
        return accessToken
      }
      return refreshNow()
    },

    refreshNow,

    get username() {
      return username
    },
    setUsername(who) {
      username = who
    },

    clear,
  }
}
