// Real drag-out (ticket 09) — the milestone. Turns "this Sound's Original is on
// disk" into an OS drag whose dropped file is a native-quality Original under a
// name a DAW can live with.
//
// Why the hardlink dance (ADR-0002, ADR-0003):
//   - The content store names files by Freesound id (`321967.wav`). Dropping
//     that path puts a region called `321967.wav` into the user's session.
//   - So each Original is HARDLINKED into `<dataDir>/drag/` under a sanitised,
//     human-readable name and THAT path is dragged. A hardlink costs no disk
//     space and shares the inode, so the dropped file keeps working after the
//     staged Original is later evicted (ticket 10) and after the app quits.
//   - A Preview mp3 is NEVER handed to the OS. If the Original is not yet
//     staged the drag is refused with a visible explanation — never a silent
//     no-op, never a substituted Preview (ADR-0003).
//
// The single OS call lives behind `DragHost` so a test can see exactly what path
// the app hands over without launching Electron.

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

// Characters that are illegal in a filename on macOS or Windows.
const ILLEGAL_NAME_CHARS = /[/\\:*?"<>|]/g
// C0 control characters plus DEL — never wanted in a filename.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g

/**
 * A drag was requested for a Sound whose Original is not on disk yet. The
 * renderer shows `message` verbatim. Distinct type so the renderer never
 * mistakes it for a generic failure and never falls back to a Preview.
 */
export class OriginalNotStagedError extends Error {
  readonly soundId: number
  constructor(soundId: number, soundName?: string) {
    super(
      `“${soundName ?? `Sound ${soundId}`}” isn’t downloaded yet. Press play and ` +
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
    // 1. Normalise the id list: dedupe, keep order, drop anything non-positive.
    const seen = new Set<number>()
    let ids = (Array.isArray(idsInput) ? idsInput : [idsInput]).filter((id) => {
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return false
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    if (ids.length === 0) throw new Error('startDrag: no Sounds to drag')

    // 2. Multi-Sound drag only where ticket 01 verified every file is delivered.
    //    Elsewhere, drag just the first Sound (the UI already hides the affordance).
    if (ids.length > 1 && !dragHost.multiFileDragSupported) {
      ids = [ids[0]!]
    }

    // 3. Resolve every Sound and require its Original to be on disk RIGHT NOW.
    //    Any missing Sound refuses the whole drag with a visible explanation.
    const sounds = ids.map((id) => {
      const sound = getSoundsByIds(db, [id])[0]
      if (!sound || !isOriginalOnDisk(sound)) {
        throw new OriginalNotStagedError(id, sound?.name)
      }
      return sound
    })

    // 4. Hardlink each Original into the drag dir under a human-readable name.
    const paths = sounds.map((sound) => hardlinkForDrag(sound))

    // 5. Resolve a guaranteed-non-empty icon.
    const iconPath = resolveIconPath(opts.iconDataUrl)

    const payload: DragPayload = {
      filePath: paths[0]!,
      extraFilePaths: paths.slice(1),
      iconPath,
    }
    dragHost.startDrag(payload)

    const soundIds = sounds.map((s) => s.id)
    // The OS now owns this drag; protect each Original from eviction until the
    // renderer signals `dragend` (or the registry's TTL lapses).
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
   * Link the Sound's Original into `<dataDir>/drag/` as `<pretty name>.<ext>`.
   * Reuses an existing link to the SAME Original; disambiguates a different
   * Sound that sanitises to the same name with ` (2)`, ` (3)`, …
   */
  function hardlinkForDrag(sound: Sound): string {
    const src = contentPaths(dataDir, sound).original
    const ext = extForSound(sound)
    const dir = join(dataDir, DRAG_DIRNAME)
    mkdirSync(dir, { recursive: true })

    const stem = sanitiseStem(sound, ext)
    const srcIno = statSync(src).ino

    for (let n = 1; ; n++) {
      const name = n === 1 ? `${stem}.${ext}` : `${stem} (${n}).${ext}`
      const dest = join(dir, name)

      if (existsSync(dest)) {
        // Same inode → an earlier drag of THIS Original; reuse it (idempotent).
        // Different inode → a name collision with another Sound; try ` (n+1)`.
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
          // The drag dir is on a different volume from the content store; a
          // hardlink is impossible. Copy instead so the drag still works
          // (ticket 01 findings §2.4). A copy is independent of eviction anyway.
          writeFileSync(dest, readFileSync(src))
        } else if (code === 'EEXIST') {
          continue // lost a race; try the next candidate
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
  const meta = url.slice('data:'.length, comma) // e.g. "image/png;base64"
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
