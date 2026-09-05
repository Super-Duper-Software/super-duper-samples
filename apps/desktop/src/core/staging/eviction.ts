import { rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DB } from '../db/index'
import type { Sound } from '../types'
import { getSoundsByIds } from '../db/sounds'
import { deletePeaksRecord } from '../db/peaks'
import {
  hasLibraryEntry,
  listStagedEntries,
  type StagedEntry,
} from '../db/staged'
import { CONTENT_DIRNAME, contentPaths } from './contentStore'
import type { InFlightDrags } from './dragRegistry'

/**
 * Default cap on total bytes of Staged Originals on disk: 2 GiB. Overridable
 * per-core via `CoreDeps.stagingByteBudget`. Chosen to comfortably hold a few
 * hundred auditioned Originals (a typical Freesound Original is a few MB, a long
 * uncompressed one tens of MB) while staying a small fraction of any modern
 * disk — the user never sees or manages this number.
 */
export const DEFAULT_STAGING_BYTE_BUDGET = 2 * 1024 * 1024 * 1024

/** Current on-disk footprint, split by intent. All values are bytes. */
export interface DiskUsage {
  /** Sum of `staged_entries.byte_size` — auditioned-but-unsaved Originals. */
  staged: number
  /** Sum of the on-disk size of every Library Original (each file is stat-ed). */
  library: number
  /** `staged + library`. */
  total: number
}

/** What an eviction / clear pass did. */
export interface EvictionOutcome {
  /** Sound ids whose Original + sidecar + row were removed, LRU-first. */
  evicted: number[]
  /** Bytes reclaimed (sum of the evicted rows' `byte_size`). */
  freedBytes: number
  /** Sound ids skipped because they are in the Library or have a live Drag-Out. */
  skipped: number[]
}

/** Resolve the Original + sidecar paths for a staged row. */
function pathsFor(
  db: DB,
  dataDir: string,
  entry: StagedEntry,
): { original: string; sidecar: string } {
  if (entry.path) {
    return {
      original: entry.path,
      sidecar: join(dirname(entry.path), `${entry.soundId}.json`),
    }
  }
  const sound = getSoundsByIds(db, [entry.soundId])[0]
  if (sound) {
    const p = contentPaths(dataDir, sound)
    return { original: p.original, sidecar: p.sidecar }
  }
  const dir = join(dataDir, CONTENT_DIRNAME)
  return {
    original: join(dir, String(entry.soundId)),
    sidecar: join(dir, `${entry.soundId}.json`),
  }
}

/**
 * Unlink a Sound's Original and its mandatory sidecar from the content store,
 * Original FIRST so an interrupted call can only ever leave a harmless
 * sidecar-without-audio. Missing files are not an error. Touches no DB row — the
 * caller owns whichever row (`staged_entries` / `library_entries`) pointed at
 * these files. Shared by staging eviction (below) and `core.deleteFromLibrary`
 *.
 */
export async function removeContentFiles(
  dataDir: string,
  sound: Pick<Sound, 'id' | 'type'>,
): Promise<void> {
  const { original, sidecar } = contentPaths(dataDir, sound)
  await rm(original, { force: true })
  await rm(sidecar, { force: true })
}

/** Remove one staged Sound whole: Original, then sidecar, then the DB row. */
async function removeStaged(
  db: DB,
  dataDir: string,
  entry: StagedEntry,
): Promise<void> {
  const { original, sidecar } = pathsFor(db, dataDir, entry)
  await rm(original, { force: true })
  await rm(sidecar, { force: true })
  db.prepare('DELETE FROM staged_entries WHERE sound_id = ?').run(entry.soundId)
  deletePeaksRecord(db, entry.soundId)
}

/** True if this Sound must survive any eviction / clear. */
function isProtected(
  db: DB,
  inFlightDrags: InFlightDrags,
  soundId: number,
): boolean {
  return hasLibraryEntry(db, soundId) || inFlightDrags.has(soundId)
}

/**
 * Bring total Staged bytes at or under `byteBudget` by evicting
 * least-recently-accessed Staged Sounds first. A no-op when already within
 * budget. Never touches Library Sounds or Sounds with a live Drag-Out — if only
 * protected Sounds remain, the total is left above budget rather than forcing
 * anything out.
 */
export async function evictStagedOverBudget(
  db: DB,
  dataDir: string,
  byteBudget: number,
  inFlightDrags: InFlightDrags,
): Promise<EvictionOutcome> {
  const entries = listStagedEntries(db)
  let total = entries.reduce((n, e) => n + e.byteSize, 0)

  const evicted: number[] = []
  const skipped: number[] = []
  let freedBytes = 0

  for (const entry of entries) {
    if (total <= byteBudget) break
    if (isProtected(db, inFlightDrags, entry.soundId)) {
      skipped.push(entry.soundId)
      continue
    }
    await removeStaged(db, dataDir, entry)
    total -= entry.byteSize
    freedBytes += entry.byteSize
    evicted.push(entry.soundId)
  }

  return { evicted, freedBytes, skipped }
}

/**
 * Remove every Staged Original + sidecar + row on demand, to reclaim space. The
 * Library is left completely untouched; a Sound with a live Drag-Out is skipped
 * (and reported in `skipped`).
 */
export async function clearStaged(
  db: DB,
  dataDir: string,
  inFlightDrags: InFlightDrags,
): Promise<EvictionOutcome> {
  const entries = listStagedEntries(db)

  const evicted: number[] = []
  const skipped: number[] = []
  let freedBytes = 0

  for (const entry of entries) {
    if (isProtected(db, inFlightDrags, entry.soundId)) {
      skipped.push(entry.soundId)
      continue
    }
    await removeStaged(db, dataDir, entry)
    freedBytes += entry.byteSize
    evicted.push(entry.soundId)
  }

  return { evicted, freedBytes, skipped }
}

/**
 * Current disk footprint, split between Staged and Library. Staged bytes come
 * straight from `staged_entries.byte_size`; Library bytes are measured by
 * stat-ing each Library Original in the content store (a missing file counts as
 * zero). Library sizing has no dedicated column — the row count is small and
 * this keeps the schema append-only.
 */
export async function computeDiskUsage(
  db: DB,
  dataDir: string,
): Promise<DiskUsage> {
  const staged = Number(
    (
      db
        .prepare('SELECT COALESCE(SUM(byte_size), 0) AS n FROM staged_entries')
        .get() as { n: number }
    ).n,
  )

  const libraryIds = (
    db.prepare('SELECT sound_id FROM library_entries').all() as {
      sound_id: number
    }[]
  ).map((r) => r.sound_id)

  let library = 0
  for (const sound of getSoundsByIds(db, libraryIds)) {
    try {
      library += (await stat(contentPaths(dataDir, sound).original)).size
    } catch {
      // File gone (e.g. removed out-of-band) — contributes nothing.
    }
  }

  return { staged, library, total: staged + library }
}
