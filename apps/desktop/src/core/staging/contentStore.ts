import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EditSpec, Sound } from '../types'

/** Subdirectory of `dataDir` that holds every staged / library Original. */
export const CONTENT_DIRNAME = 'content'

/**
 * Bump when the sidecar shape changes so ticket 14 can migrate old files.
 * v2 (ticket 01, ADR-0005) adds the optional `derivedFrom` / `editSpec` fields
 * for an Edit's sidecar; every existing field is unchanged.
 * v3 adds the optional `customName` field so an Edit's user-chosen name — its
 * only real name, ADR-0005 — survives a Library rebuild. It is kept in sync by
 * `writeEditSidecarCustomName` on every rename; every existing field is unchanged.
 */
export const SIDECAR_SCHEMA_VERSION = 3

/**
 * The sidecar document. Everything ticket 14 needs to reconstruct a `sounds` row
 * (+ a `library_entries` row for files that were saved) from the directory alone.
 *
 * `derivedFrom` / `editSpec` are set only for an Edit's sidecar (ADR-0005) —
 * the parent Sound's id and the spec the Edit was rendered from.
 */
export interface Sidecar {
  schemaVersion: number
  soundId: number
  /** The Sound's page on freesound.org (CC-BY attribution requires this). */
  freesoundUrl: string
  /** Epoch ms the Original was written to the store. */
  downloadedAt: number
  author: { username: string }
  license: { url: string; name: string }
  file: { name: string; ext: string; byteSize: number }
  /** The full Sound metadata, verbatim — mirrors the core `Sound` type. */
  sound: Sound
  /** The parent Sound's id — set only for an Edit's sidecar. */
  derivedFrom?: number
  /** The spec this Edit was rendered from — set only for an Edit's sidecar. */
  editSpec?: EditSpec
  /**
   * The user's own name for this item (`library_entries.custom_name`), mirrored
   * here so a rebuild can restore it. For an Edit this IS its name (ADR-0005):
   * `sound.name` is only the bare `edited` / `edited (N)` placeholder the core
   * mints, so without this a rebuilt Edit comes back called "edited". Absent /
   * `null` means the user has not named it.
   */
  customName?: string | null
}

/** Lower-cased, dot-free extension for a Sound, from its Freesound `type`. */
export function extForSound(sound: Pick<Sound, 'type'>): string {
  return (sound.type || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
}

export interface ContentPaths {
  dir: string
  original: string
  sidecar: string
  ext: string
}

/** Resolve every path the store uses for one Sound. Creates nothing. */
export function contentPaths(dataDir: string, sound: Pick<Sound, 'id' | 'type'>): ContentPaths {
  const dir = join(dataDir, CONTENT_DIRNAME)
  const ext = extForSound(sound)
  return {
    dir,
    ext,
    original: join(dir, `${sound.id}.${ext}`),
    sidecar: join(dir, `${sound.id}.json`),
  }
}

/** True when a complete Original for this Sound is already in the store. */
export function isOriginalOnDisk(
  dataDir: string,
  sound: Pick<Sound, 'id' | 'type'>,
): boolean {
  return existsSync(contentPaths(dataDir, sound).original)
}

export interface WriteResult {
  paths: ContentPaths
  byteSize: number
  sidecar: Sidecar
}

/**
 * Write `bytes` as the Sound's Original plus its sidecar, atomically. Safe to
 * call when the files already exist (it overwrites via rename). Returns the
 * resolved paths and the byte size.
 */
export async function writeOriginal(
  dataDir: string,
  sound: Sound,
  bytes: Uint8Array,
  now: number,
): Promise<WriteResult> {
  const paths = contentPaths(dataDir, sound)
  await mkdir(paths.dir, { recursive: true })

  const byteSize = bytes.byteLength
  const sidecar: Sidecar = {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    soundId: sound.id,
    freesoundUrl: sound.url,
    downloadedAt: now,
    author: { username: sound.username },
    license: { url: sound.license.url, name: sound.license.name },
    file: { name: `${sound.id}.${paths.ext}`, ext: paths.ext, byteSize },
    sound,
  }

  const tag = randomBytes(6).toString('hex')
  const tmpSidecar = `${paths.sidecar}.${tag}.part`
  const tmpOriginal = `${paths.original}.${tag}.part`

  try {
    await writeFile(tmpSidecar, JSON.stringify(sidecar, null, 2), 'utf8')
    await writeFile(tmpOriginal, bytes)
    await rename(tmpSidecar, paths.sidecar)
    await rename(tmpOriginal, paths.original)
  } catch (err) {
    await rm(tmpSidecar, { force: true })
    await rm(tmpOriginal, { force: true })
    throw err
  }

  return { paths, byteSize, sidecar }
}

export interface EditPaths {
  dir: string
  original: string
  sidecar: string
}

/** The first unused `<parentId>-edited[-N].<ext>` original + sidecar pair. */
export function nextEditPaths(
  dataDir: string,
  parentSoundId: number,
  ext: string,
): EditPaths {
  const dir = join(dataDir, CONTENT_DIRNAME)
  const base = (suffix: string) => join(dir, `${parentSoundId}-edited${suffix}.${ext}`)
  let suffix = ''
  let n = 2
  while (existsSync(base(suffix))) {
    suffix = `-${n}`
    n++
  }
  return { dir, original: base(suffix), sidecar: join(dir, `${parentSoundId}-edited${suffix}.json`) }
}

export interface WriteEditResult {
  byteSize: number
  sidecar: Sidecar
}

/**
 * Finalise a rendered Edit: the renderer already wrote the audio to
 * `tmpOriginalPath` (see `AudioRenderRunner`); this writes the sidecar and
 * atomically renames both into place at `paths`, in the same
 * sidecar-then-original order `writeOriginal` uses — the invariant "the
 * Original exists ⇒ its sidecar exists" holds for an Edit too.
 */
export async function finalizeEditFiles(
  editSound: Sound,
  parentSoundId: number,
  editSpec: EditSpec,
  paths: EditPaths,
  tmpOriginalPath: string,
  byteSize: number,
  now: number,
  customName: string | null = null,
): Promise<WriteEditResult> {
  await mkdir(paths.dir, { recursive: true })

  const sidecar: Sidecar = {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    soundId: editSound.id,
    freesoundUrl: editSound.url,
    downloadedAt: now,
    author: { username: editSound.username },
    license: { url: editSound.license.url, name: editSound.license.name },
    file: {
      name: paths.original.slice(paths.dir.length + 1),
      ext: editSound.type,
      byteSize,
    },
    sound: editSound,
    derivedFrom: parentSoundId,
    editSpec,
    customName,
  }

  const tag = randomBytes(6).toString('hex')
  const tmpSidecar = `${paths.sidecar}.${tag}.part`

  try {
    await writeFile(tmpSidecar, JSON.stringify(sidecar, null, 2), 'utf8')
    await rename(tmpSidecar, paths.sidecar)
    await rename(tmpOriginalPath, paths.original)
  } catch (err) {
    await rm(tmpSidecar, { force: true })
    await rm(tmpOriginalPath, { force: true })
    throw err
  }

  return { byteSize, sidecar }
}

/** The sidecar path beside an Edit's Original (`…/foo.wav` -> `…/foo.json`). */
function editSidecarPath(localPath: string): string {
  return localPath.replace(/\.[^./\\]+$/, '.json')
}

/**
 * Rewrite the `customName` field of an Edit's sidecar so its user-chosen name
 * survives a Library rebuild (ADR-0005). Called synchronously from
 * `Core.setCustomName` for a negative id, right after the DB write. Atomic
 * (temp file + rename). A missing sidecar is a silent no-op — the Edit's files
 * may have been removed out from under us; an unreadable/unparseable one throws,
 * since that is real corruption the caller should log.
 */
export function writeEditSidecarCustomName(
  localPath: string,
  customName: string | null,
): void {
  const sidecarPath = editSidecarPath(localPath)
  if (!existsSync(sidecarPath)) return
  const parsed = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Sidecar
  parsed.customName = customName
  parsed.schemaVersion = SIDECAR_SCHEMA_VERSION
  const tmp = `${sidecarPath}.${randomBytes(6).toString('hex')}.part`
  try {
    writeFileSync(tmp, JSON.stringify(parsed, null, 2), 'utf8')
    renameSync(tmp, sidecarPath)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

/** Remove an Edit's file + sidecar (derived from `local_path`). Missing files are not an error. */
export async function removeEditFiles(localPath: string): Promise<void> {
  const sidecar = editSidecarPath(localPath)
  await rm(localPath, { force: true })
  await rm(sidecar, { force: true })
}
