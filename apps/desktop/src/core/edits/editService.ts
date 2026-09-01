// Edit creation orchestration (ticket 01/02, ADR-0005).
//
// `createEdit` renders a parent Sound's Original through an injected
// `audioRenderRunner` — the same seam shape as `computePeaksRunner` /
// `rebuildRunner` (spec 0001 § "Things that will be tempting and are wrong":
// no binary dependency, no `electron`, ever enters the core). On success it
// writes the Edit's file + sidecar to the content store and a negative-id
// `sounds` row + `library_entries` row in one transaction — an Edit is born
// in the Library, never Staged (ADR-0005).
//
// Ticket 02: the full `EditSpec` is honoured. `trim` is validated + clamped
// against the parent's own duration BEFORE any render starts (`resolveTrim`);
// the Edit's format/sample rate/channels reflect the CHOSEN output, not the
// source; the runner reports the rendered duration, which for a trim is the
// shorter one. The production runner (a single `ffmpeg-static` invocation)
// lives in `src/main`; the core still never spawns it.

import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'
import type { DB } from '../db/index'
import { getSoundsByIds } from '../db/sounds'
import { saveLibraryEntry } from '../db/library'
import {
  insertEditSoundRow,
  listEditNamesForParent,
  nextEditId,
} from '../db/edits'
import { pickEditName } from './editName'
import { resolveTrim } from './trim'
import { isAbortError } from '../errors'
import {
  contentPaths,
  finalizeEditFiles,
  isOriginalOnDisk,
  nextEditPaths,
} from '../staging/contentStore'
import type { EditSpec, Sound } from '../types'

/** What a finished render produced. */
export interface AudioRenderResult {
  byteSize: number
  durationSec: number
}

/** One render invocation's inputs — the shape `audioRenderRunner` receives. */
export interface AudioRenderInput {
  sourcePath: string
  spec: EditSpec
  /** Where the runner must write the rendered file. Not yet the Edit's final path. */
  outPath: string
  signal: AbortSignal
  /** Fraction in [0, 1], reported as often as the runner can manage. */
  onProgress?: (fraction: number) => void
  /** Tags the runner must write into the output file's metadata (ticket 02). */
  metadata: { title: string; author: string; licenseUrl: string }
}

/**
 * Renders one Edit. Production wraps a spawned `ffmpeg-static` binary in
 * `src/main` (ticket 02); tests inject a fake that can simulate a fast
 * success, a slow success with progress, an abort, and a failure.
 */
export type AudioRenderRunner = (
  input: AudioRenderInput,
) => Promise<AudioRenderResult>

export type EditEvent =
  | { parentSoundId: number; status: 'progress'; progress: number }
  | { parentSoundId: number; status: 'failed'; error: string }

export interface EditServiceDeps {
  db: DB
  dataDir: string
  /** Test/production seam: replace the render step entirely. */
  runner?: AudioRenderRunner
  /** Broadcast render progress and terminal failure (main forwards it to the renderer). */
  onEvent?: (event: EditEvent) => void
}

export interface EditService {
  /**
   * Render `parentSoundId`'s Original into a new Edit per `spec`. Resolves
   * `{ editId }` once the Edit is a complete Library item. Resolves `null`
   * (a silent no-op, never touching the gateway) when the parent is unknown,
   * its Original is not on disk, no runner is configured, or the render was
   * cancelled via `cancelEdit`. Rejects on a genuine render failure.
   */
  createEdit(
    parentSoundId: number,
    spec: EditSpec,
  ): Promise<{ editId: number } | null>
  /** Abort an in-flight render for this parent. No-op if none is running. */
  cancelEdit(parentSoundId: number): void
  subscribe(listener: (event: EditEvent) => void): () => void
  close(): void
}

const EMPTY_PREVIEW_URLS = { hqMp3: '', lqMp3: '', hqOgg: '', lqOgg: '' }
const EMPTY_WAVEFORM_URLS = { m: '', l: '' }

export function createEditService(deps: EditServiceDeps): EditService {
  const { db, dataDir, runner } = deps
  const listeners = new Set<(e: EditEvent) => void>()
  const inFlight = new Map<number, AbortController>()

  function emit(event: EditEvent): void {
    for (const l of listeners) l(event)
    deps.onEvent?.(event)
  }

  async function createEdit(
    parentSoundId: number,
    spec: EditSpec,
  ): Promise<{ editId: number } | null> {
    if (!runner) return null

    const parent = getSoundsByIds(db, [parentSoundId])[0]
    if (!parent || !isOriginalOnDisk(dataDir, parent)) return null

    // Validate + clamp the trim window against the SOURCE's duration before
    // touching the runner at all — a bad region never starts a render.
    const trim = resolveTrim(parent.duration, spec.trim)
    const effectiveSpec: EditSpec = { ...spec, trim }

    const ext = effectiveSpec.format // ticket 02: the CHOSEN output format
    const paths = nextEditPaths(dataDir, parentSoundId, ext)
    const tmpOutPath = `${paths.original}.${randomBytes(6).toString('hex')}.render`

    const controller = new AbortController()
    inFlight.set(parentSoundId, controller)

    try {
      const result = await runner({
        sourcePath: contentPaths(dataDir, parent).original,
        spec: effectiveSpec,
        outPath: tmpOutPath,
        signal: controller.signal,
        onProgress: (progress) =>
          emit({ parentSoundId, status: 'progress', progress }),
        metadata: {
          title: parent.name,
          author: parent.username,
          licenseUrl: parent.license.url,
        },
      })

      const editId = nextEditId(db)
      const name = pickEditName(listEditNamesForParent(db, parentSoundId))
      const now = Date.now()

      const editSound: Sound = {
        id: editId,
        name,
        username: parent.username,
        license: parent.license,
        duration: result.durationSec,
        tags: parent.tags,
        filesize: result.byteSize,
        type: ext,
        samplerate: effectiveSpec.sampleRate ?? parent.samplerate,
        channels: effectiveSpec.channels ?? parent.channels,
        bitdepth: parent.bitdepth,
        previewUrls: EMPTY_PREVIEW_URLS,
        waveformUrls: EMPTY_WAVEFORM_URLS,
        url: parent.url,
        downloadCount: 0,
        avgRating: 0,
        created: new Date(now).toISOString(),
      }

      await finalizeEditFiles(
        editSound,
        parentSoundId,
        effectiveSpec,
        paths,
        tmpOutPath,
        result.byteSize,
        now,
      )

      db.transaction(() => {
        insertEditSoundRow(db, {
          editId,
          parentSoundId,
          editSpec: effectiveSpec,
          localPath: paths.original,
          sound: editSound,
        })
        saveLibraryEntry(db, editId, now)
      })()

      return { editId }
    } catch (err) {
      await rm(tmpOutPath, { force: true }).catch(() => {})
      if (isAbortError(err) || controller.signal.aborted) return null
      emit({
        parentSoundId,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    } finally {
      if (inFlight.get(parentSoundId) === controller) {
        inFlight.delete(parentSoundId)
      }
    }
  }

  function cancelEdit(parentSoundId: number): void {
    inFlight.get(parentSoundId)?.abort()
  }

  return {
    createEdit,
    cancelEdit,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      for (const c of inFlight.values()) c.abort()
      inFlight.clear()
      listeners.clear()
    },
  }
}

