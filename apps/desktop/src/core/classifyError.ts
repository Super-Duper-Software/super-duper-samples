import { DEFAULT_RETRY_AFTER_SECONDS } from './errors'

/** The distinct failure categories the shell reports differently. */
export type ErrorKind =
  | 'network'
  | 'throttled'
  | 'auth'
  | 'download'
  | 'disk'
  | 'unknown'

export interface ClassifiedError {
  kind: ErrorKind
  /** A few words for the notification heading. */
  title: string
  /** One sentence of body text; says what to do when `actionable`. */
  detail: string
  actionable: boolean
  /** Seconds until a retry is worth trying — only ever set for `throttled`. */
  retryAfter: number | null
}

function nameOf(e: unknown): string {
  if (e instanceof Error) return e.name
  if (
    e &&
    typeof e === 'object' &&
    typeof (e as { name?: unknown }).name === 'string'
  ) {
    return (e as { name: string }).name
  }
  return ''
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message
  if (
    e &&
    typeof e === 'object' &&
    typeof (e as { message?: unknown }).message === 'string'
  ) {
    return (e as { message: string }).message
  }
  return String(e ?? '')
}

/**
 * Turn any thrown value — including one that has crossed IPC and lost its
 * prototype — into a renderable, categorised error. Matches on `name` and
 * message rather than `instanceof`, which does not survive structured-clone.
 */
export function classifyError(e: unknown): ClassifiedError {
  const name = nameOf(e)
  const message = messageOf(e)
  const anyE = (e ?? {}) as Record<string, unknown>

  if (name === 'ThrottledError' || /rate.?limit/i.test(message)) {
    const field =
      typeof anyE['retryAfter'] === 'number'
        ? (anyE['retryAfter'] as number)
        : null
    const fromMsg = message.match(/(\d+)\s*s/)
    const retryAfter =
      field ?? (fromMsg ? Number(fromMsg[1]) : DEFAULT_RETRY_AFTER_SECONDS)
    return {
      kind: 'throttled',
      title: 'Freesound rate limit hit',
      detail: `Too many requests. This clears on its own — try again in about ${retryAfter}s.`,
      actionable: true,
      retryAfter,
    }
  }

  if (
    name === 'NetworkError' ||
    /network|offline|fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(
      message,
    )
  ) {
    return {
      kind: 'network',
      title: 'No connection to Freesound',
      detail:
        'Check your internet connection, then try again. Your Library still works offline.',
      actionable: true,
      retryAfter: null,
    }
  }

  if (
    name === 'AuthError' ||
    name === 'NotSignedInError' ||
    name === 'ReauthRequiredError' ||
    name === 'OAuthStateMismatchError' ||
    name === 'SignInCancelledError' ||
    /sign(ed)?.?in|not authorized|unauthori[sz]ed|401/i.test(message)
  ) {
    return {
      kind: 'auth',
      title: 'Sign-in needed',
      detail:
        name === 'NotSignedInError'
          ? 'Sign in with your Freesound account to search.'
          : 'Sign in with your Freesound account to download Originals and drag them out.',
      actionable: true,
      retryAfter: null,
    }
  }

  if (name === 'LoopbackPortInUseError' || /EADDRINUSE/i.test(message)) {
    return {
      kind: 'auth',
      title: 'Could not start sign-in',
      detail:
        'Port 8910 is in use by another program. Close it and try signing in again.',
      actionable: true,
      retryAfter: null,
    }
  }

  if (name === 'DiskError' || /ENOSPC|EACCES|EROFS|EPERM|disk|no space/i.test(message)) {
    const noSpace = /ENOSPC|no space/i.test(message) || anyE['code'] === 'ENOSPC'
    return {
      kind: 'disk',
      title: noSpace ? 'Disk is full' : 'Could not write to disk',
      detail: noSpace
        ? 'Free up some space on this device, then try again.'
        : 'The app could not write to its data folder. Check the folder’s permissions.',
      actionable: true,
      retryAfter: null,
    }
  }

  if (name === 'DownloadCancelledError' || name === 'AbortError') {
    return {
      kind: 'download',
      title: 'Download stopped',
      detail: 'You moved on before this finished downloading. Play it again to retry.',
      actionable: true,
      retryAfter: null,
    }
  }

  if (name === 'GatewayError' || /freesound|gateway|5\d\d/i.test(message)) {
    return {
      kind: 'download',
      title: 'Freesound returned an error',
      detail:
        'This is a problem on Freesound’s side, not something you can fix. Try again later.',
      actionable: false,
      retryAfter: null,
    }
  }

  return {
    kind: 'unknown',
    title: 'Something went wrong',
    detail: message || 'An unexpected error occurred. The details are in the app log.',
    actionable: false,
    retryAfter: null,
  }
}
