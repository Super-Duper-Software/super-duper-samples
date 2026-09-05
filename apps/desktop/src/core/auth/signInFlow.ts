import { randomBytes } from 'node:crypto'
import type { AuthPlatform } from './platform'
import type { Scheduler } from './scheduler'
import { LoopbackPortInUseError, SignInCancelledError, OAuthStateMismatchError } from './errors'

const FREESOUND_AUTHORIZE_URL = 'https://freesound.org/apiv2/oauth2/authorize/'
export const LOOPBACK_PORT = 8910
const CALLBACK_PATH = '/callback'
export const REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}${CALLBACK_PATH}`

export function generateOAuthState(): string {
  return randomBytes(16).toString('hex')
}

function isAddrInUse(err: unknown): boolean {
  return (
    err instanceof LoopbackPortInUseError ||
    (!!err &&
      typeof err === 'object' &&
      (err as { code?: unknown }).code === 'EADDRINUSE')
  )
}

export interface BrowserStepArgs {
  platform: AuthPlatform
  scheduler: Scheduler
  clientId: string
  expectedState: string
  timeoutMs: number
}

export interface LoopbackCallback {
  code?: string
  state?: string
  error?: string
}

/**
 * Open the system browser at Freesound's authorize page and wait for the
 * one-shot loopback listener to catch the redirect. Aborts after `timeoutMs`.
 * Throws `LoopbackPortInUseError` when port 8910 is taken; anything else the
 * platform threw comes through unchanged.
 */
export async function runBrowserStep(
  args: BrowserStepArgs,
): Promise<LoopbackCallback> {
  const authorizeUrl = new URL(FREESOUND_AUTHORIZE_URL)
  authorizeUrl.searchParams.set('client_id', args.clientId)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('state', args.expectedState)

  const abort = new AbortController()
  const cancelTimeout = args.scheduler.schedule(
    () => abort.abort(),
    args.timeoutMs,
  )
  try {
    const pending = args.platform.awaitLoopbackCode({
      port: LOOPBACK_PORT,
      path: CALLBACK_PATH,
      signal: abort.signal,
    })
    await args.platform.openExternal(authorizeUrl.toString())
    return await pending
  } catch (err) {
    throw isAddrInUse(err) ? new LoopbackPortInUseError(LOOPBACK_PORT) : err
  } finally {
    cancelTimeout()
  }
}

/** The authorization code, or a throw naming exactly why the callback is unusable. */
export function authorizationCodeFrom(result: LoopbackCallback): string {
  if (result.error || !result.code) throw new SignInCancelledError(result.error)
  return result.code
}

export function assertStateMatches(
  result: LoopbackCallback,
  expectedState: string,
): void {
  if (result.state !== expectedState) throw new OAuthStateMismatchError()
}
