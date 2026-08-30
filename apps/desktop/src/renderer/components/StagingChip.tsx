// The per-row staged-download indicator (ticket 08). Tells the user whether the
// Sound's Original is on disk and draggable yet, still coming, or unavailable —
// and keeps "unavailable" (a permanent failure) visually distinct from "slow"
// (still downloading). `not-started` renders nothing so idle rows stay quiet.

import { memo } from 'react'
import type { StagingStatus } from '../store/useStaging'

const BASE =
  'shrink-0 rounded px-1 text-[10px] font-medium uppercase tracking-wide'

function StagingChipImpl({ status }: { status: StagingStatus }) {
  switch (status) {
    case 'queued':
      return (
        <span
          className={`${BASE} border border-neutral-700 text-neutral-400`}
          title="Queued to download so this Sound can be dragged out"
        >
          queued
        </span>
      )
    case 'downloading':
      return (
        <span
          className={`${BASE} border border-sky-800/70 bg-sky-950/50 text-sky-300`}
          title="Downloading the Original — draggable in a moment"
        >
          <span className="mr-1 inline-block animate-spin">◐</span>downloading
        </span>
      )
    case 'ready':
      return (
        <span
          className={`${BASE} border border-emerald-800/70 bg-emerald-950/50 text-emerald-300`}
          title="The Original is on disk — ready to drag out"
        >
          ready
        </span>
      )
    case 'failed':
      return (
        <span
          className={`${BASE} border border-red-800/70 bg-red-950/60 text-red-300`}
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
