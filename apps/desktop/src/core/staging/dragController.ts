import { Buffer } from 'node:buffer'
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type { DB } from '../db/index'
import { getEditFieldsByIds } from '../db/edits'
import { getLibraryOverlay } from '../db/library'
import { getSoundsByIds } from '../db/sounds'
import type { Sound } from '../types'
import { contentPaths, extForSound } from './contentStore'
import type { DragHost, DragPayload } from './dragHost'
import type { DragRegistry } from './dragRegistry'

/** Subdirectory of `dataDir` holding the human-named hardlinks handed to the OS. */
export const DRAG_DIRNAME = 'drag'
/** Where per-drag icon PNGs (from the renderer's waveform) are written. */
const ICON_SUBDIR = '.icons'
/** Cap on the sanitised name stem, before the extension. */
const MAX_STEM_LEN = 120

const ILLEGAL_NAME_CHARS = /[/\\:*?"<>|]/g
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g

/**
 * A drag was requested for a Sound whose Original is not on disk yet, or an
 * Edit (ticket 04) whose render has not finished (or whose file has gone
 * missing). The renderer shows `message` verbatim. Distinct type so the
 * renderer never mistakes it for a generic failure and never falls back to a
 * Preview.
 */
export class OriginalNotStagedError extends Error {
  readonly soundId: number
  constructor(soundId: number, soundName?: string) {
    const label = soundName ?? (soundId < 0 ? `Edit ${soundId}` : `Sound ${soundId}`)
    super(
      soundId < 0
        ? `“${label}” isn’t ready yet. Wait for the render to finish before ` +
          `dragging it out — a Preview is never dragged.`
        : `“${label}” isn’t downloaded yet. Press play and ` +
          `wait for it to finish staging before dragging it out — a Preview is ` +
          `never dragged.`,
    )
    this.name = 'OriginalNotStagedError'
    this.soundId = soundId
  }
}

export interface DragStartResult {
  /** The path handed to the OS: a hardlink with a human-readable basename. */
  filePath: string
  /** Extra hardlink paths for a multi-Sound drag (macOS only); empty otherwise. */
  extraFilePaths: string[]
  /** Sound ids actually included in the drag, primary first. */
  soundIds: number[]
}

export interface StartDragOptions {
  /**
   * PNG (or JPEG) data URL of the Sound's rendered waveform, produced by the
   * renderer to use as the drag image. Optional — a bundled waveform glyph is
   * used when it is absent or unusable, so the drag icon is never empty.
   */
  iconDataUrl?: string
}

export interface DragController {
  /**
   * `soundIds` may mix ordinary (positive) Sound ids with negative Edit ids
   * (ticket 04) — an Edit drags out exactly like a Sound, just from its own
   * `local_path` file rather than the id-named content-store path.
   */
  startDrag(
    soundIds: number | readonly number[],
    opts?: StartDragOptions,
  ): DragStartResult
  /** Whether the UI may offer multi-Sound drag on this platform (ticket 01). */
  readonly multiSoundDragSupported: boolean
}

export interface DragControllerDeps {
  db: DB
  dataDir: string
  dragHost: DragHost
  /**
   * Absolute path to the bundled fallback drag icon (a waveform glyph). Handed
   * to the OS when the renderer sends no icon or an unusable one. Required so
   * `startDrag` never passes an empty icon (ticket 01 findings §2.3).
   */
  fallbackIconPath?: string
  /**
   * In-flight-drag registry (ticket 10). `startDrag` marks each dragged Sound as
   * having a live Drag-Out; `core.endDrag` (from the renderer's `dragend`) clears
   * it. Eviction skips any Sound it still holds so the OS never loses the path
   * mid-drop. Optional — when absent, in-flight tracking is simply not recorded.
   */
  dragRegistry?: Pick<DragRegistry, 'begin'>
}

export function createDragController(deps: DragControllerDeps): DragController {
  const { db, dataDir, dragHost } = deps

  function startDrag(
    idsInput: number | readonly number[],
    opts: StartDragOptions = {},
  ): DragStartResult {
    const seen = new Set<number>()
    let ids = (Array.isArray(idsInput) ? idsInput : [idsInput]).filter((id) => {
      if (typeof id !== 'number' || !Number.isInteger(id) || id === 0) return false
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    if (ids.length === 0) throw new Error('startDrag: no Sounds to drag')

    if (ids.length > 1 && !dragHost.multiFileDragSupported) {
      ids = [ids[0]!]
    }

    const sources = new Map<number, string>()
    const sounds = ids.map((id) => {
      const sound = getSoundsByIds(db, [id])[0]
      const src = sound ? resolveDragSource(sound) : null
      if (!sound || !src) {
        throw new OriginalNotStagedError(id, sound?.name)
      }
      sources.set(id, src)
      return sound
    })

    const paths = sounds.map((sound) =>
      hardlinkForDrag(sound, effectiveDragName(sound), sources.get(sound.id)!),
    )

    const iconPath = resolveIconPath(opts.iconDataUrl)

    const payload: DragPayload = {
      filePath: paths[0]!,
      extraFilePaths: paths.slice(1),
      iconPath,
    }
    dragHost.startDrag(payload)

    const soundIds = sounds.map((s) => s.id)
    deps.dragRegistry?.begin(soundIds)

    return {
      filePath: payload.filePath,
      extraFilePaths: payload.extraFilePaths,
      soundIds,
    }
  }

  function isOriginalOnDisk(sound: Sound): boolean {
    return existsSync(contentPaths(dataDir, sound).original)
  }

  /**
   * The file a drag of this row should hand to the OS: the content-store
   * Original for a real Sound, or an Edit's own `local_path` (ticket 04) —
   * never a path derived from an Edit's negative id, which names nothing on
   * disk. Returns `null` when that file isn't there yet, which for an Edit
   * covers both "still rendering" and "row not inserted yet" (both look like
   * "no such id" to `getSoundsByIds`, which is caught by the caller).
   */
  function resolveDragSource(sound: Sound): string | null {
    if (sound.id < 0) {
      const localPath = getEditFieldsByIds(db, [sound.id]).get(sound.id)?.localPath
      return localPath && existsSync(localPath) ? localPath : null
    }
    return isOriginalOnDisk(sound) ? contentPaths(dataDir, sound).original : null
  }

  /**
   * The name the dropped file should carry: the user's custom Library name when
   * they have set one (ticket 13), otherwise the Freesound name. A blank/whitespace
   * custom name is ignored. Sanitisation happens later in `sanitiseStem`.
   */
  function effectiveDragName(sound: Sound): string {
    const custom = getLibraryOverlay(db, sound.id)?.customName
    if (typeof custom === 'string' && custom.trim() !== '') return custom
    return sound.name
  }

  /**
   * Link `srcPath` — a Sound's Original, or an Edit's own file (ticket 04) —
   * into `<dataDir>/drag/` as `<pretty name>.<ext>`. Reuses an existing link
   * to the SAME file; disambiguates a different Sound/Edit that sanitises to
   * the same name with ` (2)`, ` (3)`, …
   */
  function hardlinkForDrag(sound: Sound, displayName: string, srcPath: string): string {
    const src = srcPath
    const ext = extForSound(sound)
    const dir = join(dataDir, DRAG_DIRNAME)
    mkdirSync(dir, { recursive: true })

    const stem = sanitiseStem({ id: sound.id, name: displayName }, ext)
    const srcIno = statSync(src).ino

    for (let n = 1; ; n++) {
      const name = n === 1 ? `${stem}.${ext}` : `${stem} (${n}).${ext}`
      const dest = join(dir, name)

      if (existsSync(dest)) {
        try {
          if (statSync(dest).ino === srcIno) return dest
        } catch {
          /* vanished between calls — fall through and try to claim it */
        }
        continue
      }

      try {
        linkSync(src, dest)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EXDEV') {
          writeFileSync(dest, readFileSync(src))
        } else if (code === 'EEXIST') {
          continue
        } else {
          throw err
        }
      }
      return dest
    }
  }

  /**
   * Write the renderer's waveform data URL to a PNG and return its path; fall
   * back to the bundled glyph. Throws only if there is genuinely no icon to
   * hand over — which `startDrag` must never do (ticket 01 findings §2.3).
   */
  function resolveIconPath(iconDataUrl?: string): string {
    const decoded = decodeDataUrl(iconDataUrl)
    if (decoded) {
      const dir = join(dataDir, DRAG_DIRNAME, ICON_SUBDIR)
      mkdirSync(dir, { recursive: true })
      const file = join(
        dir,
        `icon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${decoded.ext}`,
      )
      writeFileSync(file, decoded.bytes)
      return file
    }
    if (deps.fallbackIconPath && existsSync(deps.fallbackIconPath)) {
      return deps.fallbackIconPath
    }
    throw new Error(
      'startDrag: no usable drag icon (renderer sent none and the bundled ' +
        'fallback icon is missing)',
    )
  }

  return {
    startDrag,
    get multiSoundDragSupported() {
      return dragHost.multiFileDragSupported
    },
  }
}

/** `data:image/png;base64,…` → bytes + extension, or `null` if not a usable image. */
function decodeDataUrl(
  url: string | undefined,
): { bytes: Buffer; ext: 'png' | 'jpg' } | null {
  if (!url || !url.startsWith('data:image/')) return null
  const comma = url.indexOf(',')
  if (comma < 0) return null
  const meta = url.slice('data:'.length, comma)
  if (!meta.includes('base64')) return null
  const bytes = Buffer.from(url.slice(comma + 1), 'base64')
  if (bytes.byteLength === 0) return null
  return { bytes, ext: meta.includes('jpeg') || meta.includes('jpg') ? 'jpg' : 'png' }
}

/**
 * A filesystem-safe, human-readable name stem for a Sound. Drops a trailing
 * extension that just duplicates the real one, strips characters illegal on
 * macOS or Windows, collapses whitespace, and never ends in a dot or space
 * (illegal on Windows). Falls back to `sound-<id>` if nothing is left.
 */
function sanitiseStem(sound: Pick<Sound, 'id' | 'name'>, ext: string): string {
  let stem = sound.name ?? ''
  if (stem.toLowerCase().endsWith(`.${ext}`)) {
    stem = stem.slice(0, -(ext.length + 1))
  }
  stem = stem
    .normalize('NFC')
    .replace(CONTROL_CHARS, ' ')
    .replace(ILLEGAL_NAME_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, MAX_STEM_LEN)
    .replace(/[.\s]+$/, '')
  return stem || `sound-${sound.id}`
}
