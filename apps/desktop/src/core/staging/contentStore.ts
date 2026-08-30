// The flat, app-managed content store (ADR-0002).
//
// Downloaded Originals live in `<dataDir>/content/`, one file per Sound, named by
// Freesound sound id with the Sound's own extension: `442827.wav`. Next to each
// Original sits its MANDATORY sidecar `442827.json` carrying enough Freesound
// metadata — author, License (url + name), the Freesound URL, format details —
// to rebuild a `sounds` row and a `library_entries` row if the database is ever
// lost (ADR-0002; ticket 14). The sidecar is NOT optional.
//
// Both files are written to a temp name and atomically renamed into place. The
// Original is renamed LAST, so "the `<id>.<ext>` file exists" always implies "its
// sidecar exists too" — a half-finished download is never seen as complete.

import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sound } from '../types'

/** Subdirectory of `dataDir` that holds every staged / library Original. */
export const CONTENT_DIRNAME = 'content'

/** Bump when the sidecar shape changes so ticket 14 can migrate old files. */
export const SIDECAR_SCHEMA_VERSION = 1

/**
 * The sidecar document. Everything ticket 14 needs to reconstruct a `sounds` row
 * (+ a `library_entries` row for files that were saved) from the directory alone.
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
    // Sidecar first: once the Original is in place, its sidecar is guaranteed present.
    await rename(tmpSidecar, paths.sidecar)
    await rename(tmpOriginal, paths.original)
  } catch (err) {
    await rm(tmpSidecar, { force: true })
    await rm(tmpOriginal, { force: true })
    throw err
  }

  return { paths, byteSize, sidecar }
}
