import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Sidecar } from '../../src/core/staging/contentStore'

/** The flat content store the core writes Originals, Edits and sidecars into. */
export const contentDir = (dataDir: string): string => join(dataDir, 'content')

/** A named file inside the content store — no assumption that it exists. */
export const contentPath = (dataDir: string, file: string): string =>
  join(contentDir(dataDir), file)

/**
 * `<dataDir>/content/<id>.<ext>` — where a downloaded Original lands. Takes
 * either a fixture constant (`ext`) or a real `Sound` (`type`).
 */
export const originalPath = (
  dataDir: string,
  sound: { id: number; ext: string } | { id: number; type: string },
): string =>
  contentPath(dataDir, `${sound.id}.${'ext' in sound ? sound.ext : sound.type}`)

/** `<dataDir>/content/<id>.json` — the mandatory sidecar beside every Original. */
export const sidecarPath = (dataDir: string, id: number): string =>
  contentPath(dataDir, `${id}.json`)

/** `<dataDir>/content/<parentId>-edited.<ext>` — an Edit rendered from a parent. */
export const editPath = (
  dataDir: string,
  parent: { id: number; ext: string },
): string => contentPath(dataDir, `${parent.id}-edited.${parent.ext}`)

/** The sidecar beside an Edit rendered from `parentId`. */
export const editSidecarPath = (dataDir: string, parentId: number): string =>
  contentPath(dataDir, `${parentId}-edited.json`)

/** The body `FakeFreesoundGateway` serves for a sound id. */
export const originalBytes = (id: number): string => `FAKE-ORIGINAL:${id}`

/** Byte length of `originalBytes(id)` — used to size staging budgets. */
export const originalByteLength = (id: number): number =>
  originalBytes(id).length

/** Parse a sidecar from one of the paths above. */
export const readSidecar = (path: string): Sidecar =>
  JSON.parse(readFileSync(path, 'utf8')) as Sidecar

export const listContent = (dataDir: string): string[] =>
  readdirSync(contentDir(dataDir))
