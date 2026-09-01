// Library membership + the save / remove actions (ticket 11).
//
// The core owns the truth (`library_entries`); this tiny Zustand store is the
// renderer's mirror so a result row can show a "Saved" badge without the whole
// list re-rendering: a row subscribes through `selectRowLibrary(id)` +
// `useShallow`, so only the row whose membership actually changed re-renders.
//
//   - `ensure(ids)` batch-fetches membership for rows we do not know yet
//     (one `getLibraryMembership` call), mirroring `useStaging.ensure`.
//   - `save(sound)` / `remove(id)` call the core and then patch `memberIds`
//     locally so the badge flips immediately.
//   - `revision` bumps on every successful save/remove — the Library view
//     re-fetches its list when it changes.

import { create } from 'zustand'
import type { Sound } from '../../core/types'

export interface LibraryState {
  /** Sound ids known to be in the Library. */
  memberIds: Set<number>
  /** Bumped on every save / remove so the Library view re-fetches. */
  revision: number

  note: (soundId: number, inLibrary: boolean) => void
  noteMany: (membership: Record<number, boolean>) => void
  /** Ask the core for membership of ids we have no answer for yet. */
  ensure: (ids: number[]) => void
  /**
   * Download a Sound's Original and save it to the Library (CONTEXT.md § Library:
   * a Sound enters the Library only by an explicit user act, and — post
   * ADR-0003-revision — that act is the download itself; auditioning no longer
   * fetches anything). Fire-and-forget: membership flips to `true` when the
   * `ready` staging push arrives (see `useStaging`). Idempotent — a no-op on a
   * Sound already saved / on disk. Requires being signed in.
   */
  save: (sound: Sound) => Promise<void>
  /** Remove a Sound from the Library (its Original + sidecar are deleted too). */
  remove: (soundId: number) => Promise<void>
  /**
   * Ticket 13: give a Library Sound the user's own name (or clear it with
   * `null`). Bumps `revision` so the Library view re-fetches.
   */
  rename: (soundId: number, customName: string | null) => Promise<void>
  /** Ticket 13: replace a Library Sound's own tag list. Bumps `revision`. */
  setTags: (soundId: number, tags: string[]) => Promise<void>
}

function withMember(set: Set<number>, id: number, present: boolean): Set<number> {
  if (set.has(id) === present) return set
  const next = new Set(set)
  if (present) next.add(id)
  else next.delete(id)
  return next
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
    // We only ever store `true` ids; treat any id we have not fetched as unknown.
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

  save: async (sound) => {
    try {
      await window.core?.downloadToLibrary?.(sound.id, sound)
    } catch {
      return
    }
    // Membership flips on the `ready` staging push (`useStaging`), which also
    // covers the "already on disk" fast path. Bump `revision` now so the Library
    // view is ready to re-fetch the moment the row appears.
    set((s) => ({ revision: s.revision + 1 }))
  },

  remove: async (soundId) => {
    try {
      await window.core?.deleteFromLibrary?.(soundId)
    } catch {
      return
    }
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
