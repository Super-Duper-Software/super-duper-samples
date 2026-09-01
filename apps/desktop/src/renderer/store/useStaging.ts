// Per-sound staging status for the result-row indicator (ticket 08).
//
// The core owns the download queue and pushes `{ soundId, status }` on
// `window.core.onStagingStatus`. This tiny Zustand store mirrors those pushes and
// lets a row read its own status without the list re-rendering wholesale: a row
// subscribes through `selectRowStaging(id)` + `useShallow`, so only the row whose
// status actually changed re-renders.

import { create } from 'zustand'
import type { StagingStatus } from '../../preload'
import { useNotifications } from './useNotifications'
import { useLibrary } from './useLibrary'
import { useDownloadQuota } from './useDownloadQuota'

export type { StagingStatus } from '../../preload'

export interface StagingState {
  byId: Record<number, StagingStatus>
  note: (soundId: number, status: StagingStatus) => void
  noteMany: (entries: Record<number, StagingStatus>) => void
  /** Ask the core for the current status of ids we do not have yet. */
  ensure: (ids: number[]) => void
}

export const useStaging = create<StagingState>((set, get) => ({
  byId: {},
  note: (soundId, status) =>
    set((s) => ({ byId: { ...s.byId, [soundId]: status } })),
  noteMany: (entries) => set((s) => ({ byId: { ...s.byId, ...entries } })),
  ensure: (ids) => {
    const missing = ids.filter((id) => get().byId[id] === undefined)
    if (missing.length === 0) return
    try {
      void window.core
        ?.getStagingStatus?.(missing)
        ?.then((res) => get().noteMany(res))
        ?.catch?.(() => {})
    } catch {
      /* no bridge (tests) */
    }
  },
}))

// Mirror the core's pushes. Wired once, at module load.
try {
  window.core?.onStagingStatus?.((change) => {
    const prev = useStaging.getState().byId[change.soundId]
    useStaging.getState().note(change.soundId, change.status)
    // A download just landed: an explicit "Download" also saved the Sound to the
    // Library (the core wrote the row), and it spent one unit of the rolling
    // 24 h quota — reflect both without a round-trip.
    if (change.status === 'ready' && prev !== 'ready') {
      useLibrary.getState().note(change.soundId, true)
      void useDownloadQuota.getState().refresh()
    }
    // Ticket 18 — a download that fails is surfaced, not just marked on the row:
    // a "downloading" chip that silently turns to "failed" is exactly the
    // slow-vs-broken ambiguity this ticket removes.
    if (change.status === 'failed' && prev !== 'failed') {
      useNotifications.getState().push(
        {
          kind: 'download',
          title: 'Download failed',
          detail:
            'A sound’s Original could not be downloaded. Check your connection or sign-in, then play it again to retry.',
          actionable: true,
          retryAfter: null,
        },
        'staging',
      )
    }
  })
} catch {
  /* no bridge (tests) */
}

export interface RowStaging {
  status: StagingStatus
}

export function selectRowStaging(soundId: number) {
  return (s: StagingState): RowStaging => ({
    status: s.byId[soundId] ?? 'not-started',
  })
}
