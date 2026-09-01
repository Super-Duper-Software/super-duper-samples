// The read-only half of "rebuild from sidecars" (ticket 14, extended by ticket
// 06 to Edits): walk the flat content store, pair every Original with its
// mandatory `.json` sidecar (ADR-0002) — a Sound's is `<id>.json`, an Edit's is
// `<parentId>-edited[-N].json` (ADR-0005) — parse each sidecar defensively, and
// classify what is found. Pairing goes by the sidecar's own recorded
// `file.name` rather than an id parsed from the filename, since an Edit's audio
// basename does not start with its (negative) sound id. This function touches
// NO database and DELETES nothing — it only reads and reports, so it is
// trivially safe to run on a worker thread (see `rebuildWorker.ts`). The DB
// writes and the orphan-sidecar cleanup are the caller's job
// (`rebuildService.ts`).
//
// Robustness is the whole point: one unreadable or malformed sidecar is
// collected into `malformed` and the scan keeps going — it never aborts the run.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sidecar } from '../staging/contentStore'

/** A sidecar that parsed and whose Original is present on disk. */
export interface ScannedSidecar {
  soundId: number
  /** Absolute path to the `<id>.json` sidecar. */
  sidecarPath: string
  /** Absolute path to the paired Original. */
  audioPath: string
  /** Basename of the paired Original, e.g. `442827.wav`. */
  audioName: string
  sidecar: Sidecar
}

/** One sidecar that could not be read or did not carry the fields rebuild needs. */
export interface MalformedSidecar {
  /** Basename of the offending `<id>.json`. */
  file: string
  /** Human-readable reason (JSON parse error, or which field was missing). */
  error: string
}

/** The full classification of a content-store directory. */
export interface SidecarScan {
  /** Sidecars that parsed AND have their Original on disk — the rebuildable set. */
  recovered: ScannedSidecar[]
  /** Basenames of Originals with NO sidecar at all — reported, never imported, never deleted. */
  orphanAudio: string[]
  /** Absolute paths of `<id>.json` whose Original is missing — reported and (by the caller) removed. */
  orphanSidecars: string[]
  /** Sidecars that failed individually. Does not abort the scan. */
  malformed: MalformedSidecar[]
  /** Number of `<id>.json` files considered (denominator for progress). */
  total: number
}

/** `{ done, total }` — emitted as each sidecar is parsed, for a progress bar. */
export interface ScanProgress {
  done: number
  total: number
}

const EMPTY: SidecarScan = {
  recovered: [],
  orphanAudio: [],
  orphanSidecars: [],
  malformed: [],
  total: 0,
}

/** Leading integer of a content-store basename (`442827.wav` -> 442827). */
function idFromBasename(name: string): number | null {
  const m = /^(\d+)\./.exec(name)
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

/**
 * Assert the shape a rebuild depends on. Anything JSON-parseable but missing an
 * essential field (author, License, the `sound` block) is treated as malformed
 * and reported individually — never thrown past the caller. A sidecar written by
 * a newer app version is still accepted as long as these fields are present.
 */
function validateSidecar(v: unknown): Sidecar {
  if (typeof v !== 'object' || v === null) {
    throw new Error('sidecar is not a JSON object')
  }
  const o = v as Record<string, unknown>
  if (typeof o['soundId'] !== 'number' || !Number.isFinite(o['soundId'])) {
    throw new Error('missing or non-numeric "soundId"')
  }
  const sound = o['sound']
  if (typeof sound !== 'object' || sound === null) {
    throw new Error('missing "sound" metadata block')
  }
  const s = sound as Record<string, unknown>
  if (typeof s['id'] !== 'number') throw new Error('sound.id is missing')
  if (typeof s['name'] !== 'string') throw new Error('sound.name is missing')
  if (typeof s['username'] !== 'string') {
    throw new Error('sound.username is missing — the author cannot be recovered')
  }
  const lic = s['license'] as Record<string, unknown> | undefined
  if (
    !lic ||
    typeof lic['url'] !== 'string' ||
    typeof lic['name'] !== 'string'
  ) {
    throw new Error('sound.license is missing — the License cannot be recovered')
  }
  const file = o['file'] as Record<string, unknown> | undefined
  if (!file || typeof file['name'] !== 'string') {
    throw new Error('sidecar.file.name is missing — its audio cannot be located')
  }
  // An Edit's sidecar (ADR-0005): `derivedFrom` set requires `editSpec` too —
  // both or neither, or the Edit cannot be reconstructed.
  if (o['derivedFrom'] !== undefined) {
    if (typeof o['derivedFrom'] !== 'number') {
      throw new Error('derivedFrom is present but not numeric')
    }
    if (typeof o['editSpec'] !== 'object' || o['editSpec'] === null) {
      throw new Error('an Edit sidecar (derivedFrom set) is missing its editSpec')
    }
  }
  return v as Sidecar
}

/**
 * Scan `contentDir` and classify every file into recovered / orphan-audio /
 * orphan-sidecar / malformed. A missing directory yields an all-empty scan (a
 * fresh install has nothing to rebuild). `onProgress` fires once before the
 * first sidecar and once after each, so a large library shows movement.
 */
export async function scanSidecars(
  contentDir: string,
  onProgress?: (p: ScanProgress) => void,
): Promise<SidecarScan> {
  let entries: string[]
  try {
    entries = await readdir(contentDir)
  } catch {
    onProgress?.({ done: 0, total: 0 })
    return { ...EMPTY }
  }

  // Half-written downloads leave `<name>.<tag>.part` — never treat one as real.
  const files = entries.filter((f) => !f.endsWith('.part'))
  // A Sound sidecar is `<id>.json`; an Edit's is `<parentId>-edited[-N].json`
  // (`nextEditPaths`, ADR-0005).
  const jsonFiles = files.filter((f) => /^\d+(-edited(-\d+)?)?\.json$/.test(f)).sort()
  const audioFiles = files.filter((f) => !f.endsWith('.json'))
  const audioFileSet = new Set(audioFiles)

  const recovered: ScannedSidecar[] = []
  const orphanSidecars: string[] = []
  const malformed: MalformedSidecar[] = []
  const pairedAudio = new Set<string>()

  const total = jsonFiles.length
  let done = 0
  onProgress?.({ done, total })

  for (const jsonName of jsonFiles) {
    const sidecarPath = join(contentDir, jsonName)
    try {
      const raw = await readFile(sidecarPath, 'utf8')
      const sidecar = validateSidecar(JSON.parse(raw))
      const audioName = sidecar.file.name
      if (!audioFileSet.has(audioName)) {
        // Sidecar present, Original gone: report, and the caller deletes the .json.
        orphanSidecars.push(sidecarPath)
      } else {
        pairedAudio.add(audioName)
        recovered.push({
          soundId: sidecar.soundId,
          sidecarPath,
          audioPath: join(contentDir, audioName),
          audioName,
          sidecar,
        })
      }
    } catch (err) {
      malformed.push({
        file: jsonName,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    done += 1
    onProgress?.({ done, total })
  }

  // Anything left in the audio set with no `<id>.json` beside it at all is
  // orphan audio: reported so the user can attribute it by hand, never imported
  // without attribution and never deleted. An Original whose sidecar merely
  // failed to parse is already covered by `malformed` — don't double-count it.
  const orphanAudio: string[] = []
  for (const name of audioFiles) {
    if (pairedAudio.has(name)) continue
    const id = idFromBasename(name)
    if (id != null && jsonFiles.includes(`${id}.json`)) continue
    orphanAudio.push(name)
  }
  orphanAudio.sort()

  return { recovered, orphanAudio, orphanSidecars, malformed, total }
}
