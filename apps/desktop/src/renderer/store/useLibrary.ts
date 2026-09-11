import { create } from 'zustand'
import type { Sound } from '../../core/types'
import { usePeaks } from './usePeaks'
import { useTransport } from './useTransport'

export interface LibraryState {
  /** Sound ids known to be in the Library. */
  memberIds: Set<number>
  /** Bumped on every save / remove so the Library view re-fetches. */
  revision: number

  note: (soundId: number, inLibrary: boolean) => void
  noteMany: (membership: Record<number, boolean>) => void
  /**
   * A new Edit landed in the Library via `createEdit`, outside this store's own
   * `save`. Marks it a member and bumps `revision` so the Library view picks it
   * up without a manual refresh.
   */
  noteCreated: (soundId: number) => void
  /** Ask the core for membership of ids we have no answer for yet. */
  ensure: (ids: number[]) => void
  /**
   * Download a Sound's Original and save it to the Library (CONTEXT.md § Library:
   * a Sound enters the Library only by an explicit user act, and that act is
   * the download itself; auditioning no longer
   * fetches anything). Fire-and-forget: membership flips to `true` when the
   * `ready` staging push arrives (see `useStaging`). Idempotent — a no-op on a
   * Sound already saved / on disk. Requires being signed in.
   */
  save: (sound: Sound) => Promise<void>
  /** Remove a Sound from the Library (its Original + sidecar are deleted too). */
  remove: (soundId: number) => Promise<void>
  /** Give a Library Sound the user's own name (`null` clears it). Bumps `revision`. */
  rename: (soundId: number, customName: string | null) => Promise<void>
  /** Replace a Library Sound's own tag list. Bumps `revision`. */
  setTags: (soundId: number, tags: string[]) => Promise<void>
}

function withMember(set: Set<number>, id: number, present: boolean): Set<number> {
  if (set.has(id) === present) return set
  const next = new Set(set)
  if (present) next.add(id)
  else next.delete(id)
  return next
}

/**
 * Stop the row-list transport if it is sitting on `soundId` — an Edit's
 * negative id gets REUSED once a deleted Edit's id frees up
 * (`nextEditId`). Without this, `currentSoundId` stays pointed at the id from
 * BEFORE the delete, so `selectRowTransport` reports the brand new Edit at
 * that same id as already "current" the instant it appears — a click on its
 * row then calls `toggle()` (resume the stale loaded element) instead of
 * `playSound()` (load the new file fresh), playing the wrong audio until a
 * different row is played first to clear `currentSoundId`.
 */
function forgetTransportTrack(soundId: number): void {
  if (useTransport.getState().currentSoundId === soundId) {
    useTransport.getState().stop()
  }
}

export const useLibrary = create<LibraryState>((set, get) => ({
  memberIds: new Set<number>(),
  revision: 0,

  note: (soundId, inLibrary) =>
    set((s) => ({ memberIds: withMember(s.memberIds, soundId, inLibrary) })),

  noteMany: (membership) =>
    set((s) => {
      let next = s.memberIds
      for (const [id, inLib] of Object.entries(membership)) {
        next = withMember(next, Number(id), inLib)
      }
      return next === s.memberIds ? {} : { memberIds: next }
    }),

  ensure: (ids) => {
    const known = get().memberIds
    const missing = ids.filter((id) => !known.has(id))
    if (missing.length === 0) return
    try {
      void window.core
        ?.getLibraryMembership?.(missing)
        ?.then((res) => get().noteMany(res))
        ?.catch?.(() => {})
    } catch {
      /* no bridge (tests) */
    }
  },

  noteCreated: (soundId) => {
    usePeaks.getState().clear(soundId)
    forgetTransportTrack(soundId)
    set((s) => ({
      memberIds: withMember(s.memberIds, soundId, true),
      revision: s.revision + 1,
    }))
  },

  save: async (sound) => {
    try {
      await window.core?.downloadToLibrary?.(sound.id, sound)
    } catch {
      return
    }
    set((s) => ({ revision: s.revision + 1 }))
  },

  remove: async (soundId) => {
    try {
      await window.core?.deleteFromLibrary?.(soundId)
    } catch {
      return
    }
    usePeaks.getState().clear(soundId)
    forgetTransportTrack(soundId)
    set((s) => ({
      memberIds: withMember(s.memberIds, soundId, false),
      revision: s.revision + 1,
    }))
  },

  rename: async (soundId, customName) => {
    try {
      await window.core?.setCustomName?.(soundId, customName)
    } catch {
      return
    }
    set((s) => ({ revision: s.revision + 1 }))
  },

  setTags: async (soundId, tags) => {
    try {
      await window.core?.setLibraryTags?.(soundId, tags)
    } catch {
      return
    }
    set((s) => ({ revision: s.revision + 1 }))
  },
}))

export interface RowLibrary {
  inLibrary: boolean
}

export function selectRowLibrary(soundId: number) {
  return (s: LibraryState): RowLibrary => ({
    inLibrary: s.memberIds.has(soundId),
  })
}
