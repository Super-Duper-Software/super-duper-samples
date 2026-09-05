import type { DB } from '../db/index'
import type { CollectionRef, CollectionSummary, LibrarySound } from '../types'
import type { SortDir } from '../db/library'
import type { Manifest } from '../manifest/buildManifest'
import { buildManifest } from '../manifest/buildManifest'
import { getSoundsByIds } from '../db/sounds'
import {
  addMembers,
  collectionsForSounds,
  deleteCollectionRow,
  getCollectionName,
  hasCollection,
  insertCollection,
  listCollectionSummaries,
  removeMember,
  updateCollectionName,
} from '../db/collections'
import { requireLibraryEntry } from '../library/libraryCommands'
import { readCollectionSounds } from '../library/readLibrary'

export interface CollectionCommands {
  createCollection(name: string): CollectionSummary
  renameCollection(collectionId: number, name: string): void
  deleteCollection(collectionId: number): void
  addToCollection(collectionId: number, soundIds: readonly number[]): void
  removeFromCollection(collectionId: number, soundId: number): void
  listCollections(): CollectionSummary[]
  listCollectionSounds(
    collectionId: number,
    opts?: { dir?: SortDir },
  ): LibrarySound[]
  getCollectionsForSounds(soundIds: number[]): Record<number, CollectionRef[]>
  generateManifest(collectionId: number): Manifest
}

function cleanName(command: string, name: string): string {
  const clean = name.trim()
  if (clean === '') throw new Error(`${command}: name is empty`)
  return clean
}

export function createCollectionCommands(db: DB): CollectionCommands {
  return {
    createCollection(name) {
      const clean = cleanName('createCollection', name)
      return {
        id: insertCollection(db, clean, Date.now()),
        name: clean,
        count: 0,
      }
    },

    renameCollection(collectionId, name) {
      updateCollectionName(db, collectionId, cleanName('renameCollection', name))
    },

    deleteCollection: (collectionId) => deleteCollectionRow(db, collectionId),

    addToCollection(collectionId, soundIds) {
      if (!hasCollection(db, collectionId)) {
        throw new Error(`addToCollection: no collection ${collectionId}`)
      }
      for (const id of soundIds) requireLibraryEntry(db, 'addToCollection', id)
      addMembers(db, collectionId, soundIds, Date.now())
    },

    removeFromCollection: (collectionId, soundId) =>
      removeMember(db, collectionId, soundId),

    listCollections: () => listCollectionSummaries(db),

    listCollectionSounds: (collectionId, opts) =>
      readCollectionSounds(db, collectionId, opts?.dir ?? 'desc'),

    getCollectionsForSounds: (soundIds) => collectionsForSounds(db, soundIds),

    /** An Edit is attributed under its parent's Freesound name, not its own. */
    generateManifest(collectionId) {
      const name = getCollectionName(db, collectionId)
      if (name === null) {
        throw new Error(`generateManifest: no collection ${collectionId}`)
      }
      const sounds = readCollectionSounds(db, collectionId, 'desc')

      const parentIds = sounds
        .map((s) => s.derivedFrom)
        .filter((id): id is number => id != null)
      const parentNameById = new Map(
        getSoundsByIds(db, parentIds).map((p) => [p.id, p.name]),
      )

      return buildManifest({
        collectionId,
        collectionName: name,
        generatedAt: Date.now(),
        sounds: sounds.map((s) =>
          s.derivedFrom != null && parentNameById.has(s.derivedFrom)
            ? { ...s, name: parentNameById.get(s.derivedFrom)! }
            : s,
        ),
      })
    },
  }
}
