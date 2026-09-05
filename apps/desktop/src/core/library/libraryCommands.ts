import type { DB } from '../db/index'
import type { Logger } from '../logging/logger'
import type { LibraryFilter, LibrarySound, Sound } from '../types'
import type { SortDir } from '../db/library'
import { errorMessage } from '../errorMessage'
import { getSoundsByIds, upsertSound } from '../db/sounds'
import { deleteSoundRow, getEditFieldsByIds } from '../db/edits'
import {
  deleteLibraryEntry,
  hasLibraryEntry,
  libraryMembership,
  saveLibraryEntry,
  setCustomName as dbSetCustomName,
  setCustomTags as dbSetCustomTags,
} from '../db/library'
import { addMembers, clearSoundFromAllCollections, hasCollection } from '../db/collections'
import { deletePeaksRecord } from '../db/peaks'
import {
  contentPaths,
  isOriginalOnDisk,
  removeEditFiles,
  writeEditSidecarCustomName,
} from '../staging/contentStore'
import { removeContentFiles } from '../staging/eviction'
import { normaliseTags } from './libraryFilter'
import { readLibrary } from './readLibrary'

export interface LibraryCommandDeps {
  db: DB
  dataDir: string
  logger: Logger
}

export interface LibraryCommands {
  saveToLibrary(
    soundId: number,
    sound?: Sound,
    collectionIds?: readonly number[],
  ): void
  getLibraryMembership(ids: number[]): Record<number, boolean>
  listLibrary(opts?: { sort?: 'savedAt'; dir?: SortDir }): LibrarySound[]
  filterLibrary(
    filter: LibraryFilter,
    opts?: { sort?: 'savedAt'; dir?: SortDir },
  ): LibrarySound[]
  setCustomName(soundId: number, customName: string | null): void
  setLibraryTags(soundId: number, tags: string[]): void
  deleteFromLibrary(soundId: number): Promise<void>
  getContentPath(soundId: number): string | null
  getFreesoundUrl(soundId: number): string | null
}

/** Throws when `soundId` has no Library row — the precondition most of these share. */
export function requireLibraryEntry(
  db: DB,
  command: string,
  soundId: number,
): void {
  if (!hasLibraryEntry(db, soundId)) {
    throw new Error(
      `${command}: sound ${soundId} is not in the Library — save it first`,
    )
  }
}

export function createLibraryCommands(
  deps: LibraryCommandDeps,
): LibraryCommands {
  const { db, dataDir, logger } = deps

  function editLocalPath(soundId: number): string | null {
    return getEditFieldsByIds(db, [soundId]).get(soundId)?.localPath ?? null
  }

  /** Best-effort: an Edit's custom name is also mirrored into its sidecar. */
  function mirrorEditName(soundId: number, name: string | null): void {
    const localPath = editLocalPath(soundId)
    if (!localPath) return
    try {
      writeEditSidecarCustomName(localPath, name)
    } catch (err) {
      logger.warn('failed to mirror Edit name into its sidecar', {
        soundId,
        error: errorMessage(err),
      })
    }
  }

  return {
    saveToLibrary(soundId, sound, collectionIds) {
      if (sound) upsertSound(db, sound)
      if (!getSoundsByIds(db, [soundId])[0]) {
        throw new Error(
          `saveToLibrary: no metadata for sound ${soundId} — search or audition it first`,
        )
      }
      const fileInto = collectionIds ?? []
      for (const cid of fileInto) {
        if (!hasCollection(db, cid)) {
          throw new Error(`saveToLibrary: no collection ${cid}`)
        }
      }
      const now = Date.now()
      db.transaction(() => {
        saveLibraryEntry(db, soundId, now)
        for (const cid of fileInto) addMembers(db, cid, [soundId], now)
      })()
    },

    getLibraryMembership: (ids) => libraryMembership(db, ids),

    listLibrary: (opts) => readLibrary(db, opts?.dir ?? 'desc'),

    filterLibrary: (filter, opts) => readLibrary(db, opts?.dir ?? 'desc', filter),

    setCustomName(soundId, customName) {
      requireLibraryEntry(db, 'setCustomName', soundId)
      const trimmed = (customName ?? '').trim()
      const next = trimmed === '' ? null : trimmed
      dbSetCustomName(db, soundId, next)
      if (soundId < 0) mirrorEditName(soundId, next)
    },

    setLibraryTags(soundId, tags) {
      requireLibraryEntry(db, 'setLibraryTags', soundId)
      dbSetCustomTags(db, soundId, normaliseTags(tags))
    },

    async deleteFromLibrary(soundId) {
      const isEdit = soundId < 0
      const sound = getSoundsByIds(db, [soundId])[0]
      const localPath = isEdit ? editLocalPath(soundId) : null

      db.transaction(() => {
        deleteLibraryEntry(db, soundId)
        clearSoundFromAllCollections(db, soundId)
        deletePeaksRecord(db, soundId)
        if (isEdit) deleteSoundRow(db, soundId)
      })()

      if (isEdit) {
        if (localPath) await removeEditFiles(localPath)
      } else if (sound) {
        await removeContentFiles(dataDir, sound)
      }
    },

    getContentPath(soundId) {
      if (soundId < 0) return editLocalPath(soundId)
      const sound = getSoundsByIds(db, [soundId])[0]
      if (!sound || !isOriginalOnDisk(dataDir, sound)) return null
      return contentPaths(dataDir, sound).original
    },

    getFreesoundUrl: (soundId) => getSoundsByIds(db, [soundId])[0]?.url ?? null,
  }
}
