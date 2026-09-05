import { useEffect } from 'react'
import { useNotifications } from '../store/useNotifications'
import type { SearchError, SearchStatus } from './useSearch'

const NOTICE = {
  throttled: {
    kind: 'throttled' as const,
    title: 'Freesound rate limit hit',
  },
  network: {
    kind: 'network' as const,
    title: 'No connection to Freesound',
  },
  generic: {
    kind: 'download' as const,
    title: 'Search failed',
  },
}

function detail(error: SearchError): string {
  switch (error.kind) {
    case 'throttled':
      return `Too many requests. Try again in about ${error.retryAfter ?? 60}s.`
    case 'network':
      return 'Check your internet connection, then search again. Your Library still works offline.'
    default:
      return 'Freesound returned an error. This is on their side — try again later.'
  }
}

/** Raise a notification whenever a search fails, dedup'd on the `search` key. */
export function useSearchErrorNotice(
  status: SearchStatus,
  error: SearchError | null,
): void {
  useEffect(() => {
    if (status !== 'error' || !error) return
    const { kind, title } = NOTICE[error.kind]
    useNotifications.getState().push(
      {
        kind,
        title,
        detail: detail(error),
        actionable: error.kind !== 'generic',
        retryAfter: error.retryAfter,
      },
      'search',
    )
  }, [status, error])
}
