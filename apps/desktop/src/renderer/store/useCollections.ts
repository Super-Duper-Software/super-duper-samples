import { create } from 'zustand'
import type { CollectionRef, CollectionSummary } from '../../preload'

export interface CollectionsState {
  collections: CollectionSummary[]
  /** SoundId -> the Collections it belongs to. Absent id = not fetched yet. */
  memberships: Record<number, CollectionRef[]>
  /** Bumped on every create / rename / delete / add / remove. */
  revision: number
  loaded: boolean

  load: () => Promise<void>
  ensureMemberships: (ids: number[]) => void
  refreshMemberships: (ids: number[]) => Promise<void>
  create: (name: string) => Promise<CollectionSummary | null>
  rename: (collectionId: number, name: string) => Promise<void>
  remove: (collectionId: number) => Promise<void>
  addSounds: (collectionId: number, soundIds: number[]) => Promise<void>
  removeSound: (collectionId: number, soundId: number) => Promise<void>
}

const EMPTY: CollectionRef[] = []

export const useCollections = create<CollectionsState>((set, get) => ({
  collections: [],
  memberships: {},
  revision: 0,
  loaded: false,

  load: async () => {
    try {
      const list = await window.core?.listCollections?.()
      if (list) set({ collections: list, loaded: true })
    } catch {
      /* no bridge (tests) */
    }
  },

  ensureMemberships: (ids) => {
    const known = get().memberships
    const missing = ids.filter((id) => !(id in known))
    if (missing.length === 0) return
    void get().refreshMemberships(missing)
  },

  refreshMemberships: async (ids) => {
    if (ids.length === 0) return
    try {
      const res = await window.core?.getCollectionsForSounds?.(ids)
      if (!res) return
      set((s) => ({ memberships: { ...s.memberships, ...res } }))
    } catch {
      /* ignore */
    }
  },

  create: async (name) => {
    const clean = name.trim()
    if (clean === '') return null
    try {
      const made = await window.core?.createCollection?.(clean)
      await get().load()
      set((s) => ({ revision: s.revision + 1 }))
      return made ?? null
    } catch {
      return null
    }
  },

  rename: async (collectionId, name) => {
    const clean = name.trim()
    if (clean === '') return
    try {
      await window.core?.renameCollection?.(collectionId, clean)
    } catch {
      return
    }
    await get().load()
    set((s) => ({ revision: s.revision + 1 }))
  },

  remove: async (collectionId) => {
    try {
      await window.core?.deleteCollection?.(collectionId)
    } catch {
      return
    }
    await get().load()
    set((s) => {
      const memberships: Record<number, CollectionRef[]> = {}
      for (const [id, refs] of Object.entries(s.memberships)) {
        memberships[Number(id)] = refs.filter((r) => r.id !== collectionId)
      }
      return { memberships, revision: s.revision + 1 }
    })
  },

  addSounds: async (collectionId, soundIds) => {
    if (soundIds.length === 0) return
    try {
      await window.core?.addToCollection?.(collectionId, soundIds)
    } catch {
      return
    }
    await get().load()
    await get().refreshMemberships(soundIds)
    set((s) => ({ revision: s.revision + 1 }))
  },

  removeSound: async (collectionId, soundId) => {
    try {
      await window.core?.removeFromCollection?.(collectionId, soundId)
    } catch {
      return
    }
    await get().load()
    await get().refreshMemberships([soundId])
    set((s) => ({ revision: s.revision + 1 }))
  },
}))

/** Row selector: the Collections a Sound belongs to (stable empty array). */
export function selectRowCollections(soundId: number) {
  return (s: CollectionsState): CollectionRef[] => s.memberships[soundId] ?? EMPTY
}
