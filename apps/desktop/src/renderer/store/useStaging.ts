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

try {
  window.core?.onStagingStatus?.((change) => {
    const prev = useStaging.getState().byId[change.soundId]
    useStaging.getState().note(change.soundId, change.status)
    if (change.status === 'ready' && prev !== 'ready') {
      useLibrary.getState().note(change.soundId, true)
      void useDownloadQuota.getState().refresh()
    }
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
