// Renderer-side mirror of computed waveform peaks (ticket 12).
//
// A <Waveform> calls `ensure(soundId)` when it mounts / becomes relevant. The
// store asks the core for cached peaks and, if there are none, asks the core to
// compute them off-thread; a single module-level `onPeaks` subscription then
// folds the results back in as they arrive.
//
// `byId` values:
//   undefined  — not asked yet / still computing
//   null       — asked, and there are none (Original not on disk, or undecodable)
//                → the component keeps rendering the Freesound waveform image
//   PeaksPayload — draw the canvas waveform
//
// No entry is ever downgraded from a payload back to null/undefined, so a Sound
// that gains real peaks upgrades once and never flickers back to the image.

import { create } from 'zustand'
import type { PeaksPayload } from '../../core/peaks/peakService'

export type PeaksEntry = PeaksPayload | null | undefined

interface PeaksState {
  byId: Map<number, PeaksEntry>
  /** Bumped whenever `byId` gains or changes an entry, so selectors re-run. */
  revision: number
  ensure: (soundId: number) => void
  _set: (soundId: number, entry: PeaksPayload | null) => void
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
    // Mark "in progress" so a re-render does not re-request.
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
        // Nothing cached — ask the core to compute (off-thread). The outcome
        // arrives on the `onPeaks` subscription below.
        await core.requestPeaks(soundId)
      } catch {
        get()._set(soundId, null)
      }
    })()
  },

  _set: (soundId, entry) => {
    set((s) => {
      const current = s.byId.get(soundId)
      // Never overwrite a real payload with null/undefined.
      if (current && !entry) return s
      const byId = new Map(s.byId)
      byId.set(soundId, entry)
      return { byId, revision: s.revision + 1 }
    })
  },
}))

// One subscription for the whole app: when the core says a Sound's peaks are
// ready, pull them; when it says unavailable, record null so the image stays.
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
