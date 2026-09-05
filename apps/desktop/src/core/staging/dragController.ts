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
import { decodeDataUrl, sanitiseStem } from './dragNaming'
import type { DragHost, DragPayload } from './dragHost'
import type { DragRegistry } from './dragRegistry'

/** Subdirectory of `dataDir` holding the human-named hardlinks handed to the OS. */
export const DRAG_DIRNAME = 'drag'
/** Where per-drag icon PNGs (from the renderer's waveform) are written. */
const ICON_SUBDIR = '.icons'

/**
 * A drag was requested for a Sound whose Original is not on disk, or an Edit
 * whose render has not finished. The renderer shows `message` verbatim and must
 * never fall back to a Preview.
 */
export class OriginalNotStagedError extends Error {
  readonly soundId: number
  constructor(soundId: number, soundName?: string) {
    const label =
      soundName ?? (soundId < 0 ? `Edit ${soundId}` : `Sound ${soundId}`)
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
   * PNG (or JPEG) data URL of the rendered waveform, used as the drag image. A
   * bundled glyph is used when it is absent or unusable.
   */
  iconDataUrl?: string
}

export interface DragController {
  /**
   * `soundIds` may mix ordinary Sound ids with negative Edit ids; an Edit drags
   * from its own `local_path` rather than the id-named content-store path.
   */
  startDrag(
    soundIds: number | readonly number[],
    opts?: StartDragOptions,
  ): DragStartResult
  /** Whether the UI may offer multi-Sound drag on this platform. */
  readonly multiSoundDragSupported: boolean
}

export interface DragControllerDeps {
  db: DB
  dataDir: string
  dragHost: DragHost
  /** Bundled fallback drag icon, so `startDrag` never passes an empty icon. */
  fallbackIconPath?: string
  /**
   * Marks each dragged Sound as having a live Drag-Out so eviction skips it
   * until `core.endDrag`. Optional — when absent, nothing is recorded.
   */
  dragRegistry?: Pick<DragRegistry, 'begin'>
}

function uniqueIds(input: number | readonly number[]): number[] {
  const seen = new Set<number>()
  const ids = Array.isArray(input) ? input : [input as number]
  return ids.filter((id) => {
    if (typeof id !== 'number' || !Number.isInteger(id) || id === 0) return false
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function createDragController(deps: DragControllerDeps): DragController {
  const { db, dataDir, dragHost } = deps

  /**
   * The file a drag of this row hands to the OS: the content-store Original for
   * a real Sound, or an Edit's own `local_path` — never a path derived from an
   * Edit's negative id, which names nothing on disk. `null` when it is not there
   * yet (for an Edit, "still rendering" and "row not inserted" look the same).
   */
  function resolveDragSource(sound: Sound): string | null {
    if (sound.id < 0) {
      const localPath = getEditFieldsByIds(db, [sound.id]).get(
        sound.id,
      )?.localPath
      return localPath && existsSync(localPath) ? localPath : null
    }
    const original = contentPaths(dataDir, sound).original
    return existsSync(original) ? original : null
  }

  /** The user's custom Library name when they have set one, otherwise the Freesound name. */
  function effectiveDragName(sound: Sound): string {
    const custom = getLibraryOverlay(db, sound.id)?.customName
    if (typeof custom === 'string' && custom.trim() !== '') return custom
    return sound.name
  }

  /**
   * Link `srcPath` into `<dataDir>/drag/` as `<pretty name>.<ext>`. Reuses an
   * existing link to the SAME file; disambiguates a different Sound that
   * sanitises to the same name with ` (2)`, ` (3)`, …
   */
  function hardlinkForDrag(
    sound: Sound,
    displayName: string,
    srcPath: string,
  ): string {
    const ext = extForSound(sound)
    const dir = join(dataDir, DRAG_DIRNAME)
    mkdirSync(dir, { recursive: true })

    const stem = sanitiseStem({ id: sound.id, name: displayName }, ext)
    const srcIno = statSync(srcPath).ino

    for (let n = 1; ; n++) {
      const dest = join(dir, n === 1 ? `${stem}.${ext}` : `${stem} (${n}).${ext}`)

      if (existsSync(dest)) {
        try {
          if (statSync(dest).ino === srcIno) return dest
        } catch {
          /* vanished between calls — fall through and try to claim it */
        }
        continue
      }

      try {
        linkSync(srcPath, dest)
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'EXDEV') {
          writeFileSync(dest, readFileSync(srcPath))
        } else if (code === 'EEXIST') {
          continue
        } else {
          throw err
        }
      }
      return dest
    }
  }

  /** The renderer's waveform as a PNG on disk, else the bundled glyph. */
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

  function startDrag(
    idsInput: number | readonly number[],
    opts: StartDragOptions = {},
  ): DragStartResult {
    let ids = uniqueIds(idsInput)
    if (ids.length === 0) throw new Error('startDrag: no Sounds to drag')
    if (ids.length > 1 && !dragHost.multiFileDragSupported) ids = [ids[0]!]

    const sources = ids.map((id) => {
      const sound = getSoundsByIds(db, [id])[0]
      const src = sound ? resolveDragSource(sound) : null
      if (!sound || !src) throw new OriginalNotStagedError(id, sound?.name)
      return { sound, src }
    })
    const paths = sources.map(({ sound, src }) =>
      hardlinkForDrag(sound, effectiveDragName(sound), src),
    )

    const payload: DragPayload = {
      filePath: paths[0]!,
      extraFilePaths: paths.slice(1),
      iconPath: resolveIconPath(opts.iconDataUrl),
    }
    dragHost.startDrag(payload)
    deps.dragRegistry?.begin(ids)

    return {
      filePath: payload.filePath,
      extraFilePaths: payload.extraFilePaths,
      soundIds: ids,
    }
  }

  return {
    startDrag,
    get multiSoundDragSupported() {
      return dragHost.multiFileDragSupported
    },
  }
}
