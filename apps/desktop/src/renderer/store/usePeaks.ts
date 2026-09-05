import { create } from 'zustand'
import type { PeaksPayload } from '../../core/peaks/peakService'

export type PeaksEntry = PeaksPayload | null | undefined

interface PeaksState {
  byId: Map<number, PeaksEntry>
  /** Bumped whenever `byId` gains or changes an entry, so selectors re-run. */
  revision: number
  ensure: (soundId: number) => void
  _set: (soundId: number, entry: PeaksPayload | null) => void
  /**
   * Forget a cached entry. Negative (Edit) ids are locally minted and get
   * REUSED once a deleted Edit's id frees up (`nextEditId` — ADR-0005): without
   * this, `ensure()`'s "already have an entry" bail would keep serving a
   * long-gone Edit's waveform for a brand new one that happens to land on the
   * same id. Called on delete (`useLibrary.remove`) and defensively again when
   * a new Edit id shows up (`useLibrary.noteCreated`).
   */
  clear: (soundId: number) => void
}

function coreApi(): typeof window.core | undefined {
  try {
    return window.core
  } catch {
    return undefined
  }
}

export const usePeaks = create<PeaksState>((set, get) => ({
  byId: new Map(),
  revision: 0,

  ensure: (soundId) => {
    const { byId } = get()
    if (byId.has(soundId)) return
    const next = new Map(byId)
    next.set(soundId, undefined)
    set({ byId: next })

    const core = coreApi()
    if (!core) return
    void (async () => {
      try {
        const cached = await core.getPeaks(soundId)
        if (cached) {
          get()._set(soundId, cached)
          return
        }
        await core.requestPeaks(soundId)
      } catch {
        get()._set(soundId, null)
      }
    })()
  },

  _set: (soundId, entry) => {
    set((s) => {
      const current = s.byId.get(soundId)
      if (current && !entry) return s
      const byId = new Map(s.byId)
      byId.set(soundId, entry)
      return { byId, revision: s.revision + 1 }
    })
  },

  clear: (soundId) => {
    set((s) => {
      if (!s.byId.has(soundId)) return s
      const byId = new Map(s.byId)
      byId.delete(soundId)
      return { byId, revision: s.revision + 1 }
    })
  },
}))

let wired = false
export function wirePeaksSubscription(): void {
  if (wired) return
  const core = coreApi()
  if (!core?.onPeaks) return
  wired = true
  core.onPeaks((change) => {
    if (change.status === 'ready') {
      void core
        .getPeaks(change.soundId)
        .then((p) => usePeaks.getState()._set(change.soundId, p ?? null))
        .catch(() => usePeaks.getState()._set(change.soundId, null))
    } else {
      usePeaks.getState()._set(change.soundId, null)
    }
  })
}

wirePeaksSubscription()

/** Row selector: the peaks entry for one Sound (re-runs on `revision`). */
export function selectPeaks(soundId: number) {
  return (s: PeaksState): PeaksEntry => {
    void s.revision
    return s.byId.get(soundId)
  }
}
