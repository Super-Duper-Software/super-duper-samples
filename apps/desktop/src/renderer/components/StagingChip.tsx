import { memo } from 'react'
import type { StagingStatus } from '../store/useStaging'

const BASE =
  'shrink-0 rounded px-1 text-[10px] font-medium uppercase tracking-wide'

function StagingChipImpl({ status }: { status: StagingStatus }) {
  switch (status) {
    case 'queued':
      return (
        <span
          className={`${BASE} border border-line text-ink-muted`}
          title="Queued to download so this Sound can be dragged out"
        >
          queued
        </span>
      )
    case 'downloading':
      return (
        <span
          className={`${BASE} border border-accent-2 text-accent-2-text`}
          title="Downloading the Original — draggable in a moment"
        >
          <span className="mr-1 inline-block animate-spin">◐</span>downloading
        </span>
      )
    case 'ready':
      return (
        <span
          className={`${BASE} border border-ok text-ok`}
          title="The Original is on disk — ready to drag out"
        >
          ready
        </span>
      )
    case 'failed':
      return (
        <span
          className={`${BASE} border border-error text-error`}
          title="This Sound's Original could not be downloaded — it is unavailable, not just slow"
        >
          unavailable
        </span>
      )
    default:
      return null
  }
}

export const StagingChip = memo(StagingChipImpl)
