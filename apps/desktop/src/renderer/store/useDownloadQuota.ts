import { create } from 'zustand'

/** Freesound's Original-download cap per rolling 24 h. */
export const DOWNLOAD_QUOTA_LIMIT = 2000

export interface DownloadQuotaState {
  /** Downloads made in the last 24 h, or `null` before the first fetch. */
  used: number | null
  refresh: () => Promise<void>
}

export const useDownloadQuota = create<DownloadQuotaState>((set) => ({
  used: null,
  refresh: async () => {
    try {
      const n = await window.core?.getDownloadsInLast24h?.()
      if (typeof n === 'number' && Number.isFinite(n)) set({ used: n })
    } catch {
      /* no bridge (tests) / transient — leave the last known value */
    }
  },
}))

/** Downloads still available in the window, clamped at 0. `null` until first fetch. */
export function remainingDownloads(used: number | null): number | null {
  if (used == null) return null
  return Math.max(0, DOWNLOAD_QUOTA_LIMIT - used)
}
