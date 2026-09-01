// Always-visible "N downloads left" indicator in the header.
//
// Freesound limits Originals to 2,000 downloads per rolling 24 h. Its API does
// not report how many remain, so the core counts our own `download_log`; this
// component reads that count, subtracts it from the cap, and shows what is left.
// It refreshes on mount, on a slow interval (so the 24 h window slides forward
// without a reload), and whenever a download completes (`useStaging` bumps the
// quota store on a `ready` push).

import { useEffect } from 'react'
import {
  DOWNLOAD_QUOTA_LIMIT,
  remainingDownloads,
  useDownloadQuota,
} from '../store/useDownloadQuota'

/** Re-count every 60 s so old downloads age out of the 24 h window on their own. */
const REFRESH_MS = 60_000

export function DownloadQuota() {
  const used = useDownloadQuota((s) => s.used)
  const refresh = useDownloadQuota((s) => s.refresh)

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), REFRESH_MS)
    return () => clearInterval(t)
  }, [refresh])

  const remaining = remainingDownloads(used)
  if (remaining == null) return null

  const exhausted = remaining === 0
  const low = remaining <= 100

  const tone = exhausted
    ? 'border-error bg-surface-raised text-error'
    : low
      ? 'border-warn bg-surface-raised text-warn'
      : 'border-line text-ink-muted'

  // Full sentence above ~900px; below it (and always in the rail layout, which
  // is narrower still) collapse to "N ↓" with the sentence kept in `title`
  // (spec 0003). The low / exhausted colour states are unchanged.
  const full = exhausted
    ? 'Download limit reached'
    : `${remaining.toLocaleString()} download${remaining === 1 ? '' : 's'} left`
  const abbreviated = `${remaining.toLocaleString()} ↓`
  const sentence = `You have downloaded ${used ?? 0} of ${DOWNLOAD_QUOTA_LIMIT} Originals allowed by Freesound in the last 24 hours. The count rolls off as those downloads pass 24 hours old.`

  return (
    <span
      className={[
        'shrink-0 rounded border px-2 py-1 text-xs font-semibold tabular-nums',
        tone,
      ].join(' ')}
      title={sentence}
      aria-label={full}
      aria-live="polite"
    >
      <span aria-hidden className="max-[900px]:hidden">
        {full}
      </span>
      <span aria-hidden className="hidden max-[900px]:inline">
        {abbreviated}
      </span>
    </span>
  )
}
