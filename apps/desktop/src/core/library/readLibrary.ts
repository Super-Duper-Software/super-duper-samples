import type { DB } from '../db/index'
import type { LibraryFilter, LibrarySound, Sound } from '../types'
import { getSoundsByIds } from '../db/sounds'
import { getEditFieldsByIds } from '../db/edits'
import {
  getLibraryOverlay,
  listLibraryOverlays,
  type LibraryOverlay,
  type SortDir,
} from '../db/library'
import { listCollectionMemberIds } from '../db/collections'
import {
  hasLibraryFilter,
  matchesLibraryFilter,
  normaliseLibraryFilter,
} from './libraryFilter'

type EditFields = ReturnType<typeof getEditFieldsByIds>

function hydrate(
  sound: Sound,
  overlay: LibraryOverlay,
  edits: EditFields,
): LibrarySound {
  const edit = edits.get(overlay.soundId)
  return {
    ...sound,
    customName: overlay.customName,
    effectiveName: overlay.customName ?? sound.name,
    customTags: overlay.customTags,
    savedAt: overlay.savedAt,
    derivedFrom: edit?.derivedFrom ?? null,
    editSpec: edit?.editSpec ?? null,
  }
}

/**
 * The Library as `LibrarySound[]` — every `sounds` row with a `library_entries`
 * row, merged with the user's overlay, ordered by date saved and optionally
 * narrowed by a filter. Served entirely from SQLite: no gateway call, ever.
 */
export function readLibrary(
  db: DB,
  dir: SortDir,
  filter?: LibraryFilter,
): LibrarySound[] {
  const overlays = listLibraryOverlays(db, dir)
  const ids = overlays.map((o) => o.soundId)
  const byId = new Map(getSoundsByIds(db, ids).map((s) => [s.id, s]))
  const edits = getEditFieldsByIds(db, ids)

  const hydrated: LibrarySound[] = []
  for (const o of overlays) {
    const sound = byId.get(o.soundId)
    if (sound) hydrated.push(hydrate(sound, o, edits))
  }

  if (!hasLibraryFilter(filter)) return hydrated
  const f = normaliseLibraryFilter(filter)
  return hydrated.filter((s) => matchesLibraryFilter(s, f))
}

/**
 * A Collection's Sounds in the same hydrated shape `readLibrary` produces, so a
 * Collection browses in the identical list UI. Most-recently-added first (`dir`
 * flips it). Served entirely from SQLite: no gateway call, ever.
 */
export function readCollectionSounds(
  db: DB,
  collectionId: number,
  dir: SortDir,
): LibrarySound[] {
  const ids = listCollectionMemberIds(db, collectionId, dir)
  const byId = new Map(getSoundsByIds(db, ids).map((s) => [s.id, s]))
  const edits = getEditFieldsByIds(db, ids)

  const hydrated: LibrarySound[] = []
  for (const id of ids) {
    const sound = byId.get(id)
    const overlay = sound ? getLibraryOverlay(db, id) : undefined
    if (sound && overlay) hydrated.push(hydrate(sound, overlay, edits))
  }
  return hydrated
}
