/** One OS drag-out request: a primary file, optional extra files, and an icon. */
export interface DragPayload {
  /**
   * Absolute path the OS hands to the drop target. Always a hardlink in a temp
   * dir under a human-readable basename derived from the Sound — never the
   * content-store path (`<id>.<ext>`), and never a Preview.
   */
  filePath: string
  /**
   * Absolute paths of additional files for a multi-Sound drag. Empty unless the
   * caller asked for several Sounds AND `multiFileDragSupported` is true.
   */
  extraFilePaths: string[]
  /** Absolute path to a non-empty PNG shown under the cursor during the drag. */
  iconPath: string
}

export interface DragHost {
  /**
   * Begin an OS drag. Called (via IPC) from the renderer's `dragstart` handler
   * after `event.preventDefault()`.
   */
  startDrag(payload: DragPayload): void
  /**
   * True only on platforms where ticket 01 verified that EVERY file of a
   * multi-file drag reaches EVERY target application (macOS). Elsewhere —
   * notably Windows Explorer, which drops all but one file (electron#9019) — the
   * UI must not offer multi-Sound drag and the controller drags only the first
   * Sound.
   */
  readonly multiFileDragSupported: boolean
}

export interface RecordingDragHost extends DragHost {
  /** Every `startDrag` call, in order. */
  readonly drags: DragPayload[]
  /** The most recent `startDrag` payload, or `undefined`. */
  readonly last: DragPayload | undefined
}

/** In-memory `DragHost` for tests: records payloads, touches no OS. */
export function createRecordingDragHost(
  opts: { multiFileDragSupported?: boolean } = {},
): RecordingDragHost {
  const drags: DragPayload[] = []
  return {
    multiFileDragSupported: opts.multiFileDragSupported ?? true,
    startDrag(payload) {
      drags.push({
        ...payload,
        extraFilePaths: [...payload.extraFilePaths],
      })
    },
    get drags() {
      return drags
    },
    get last() {
      return drags[drags.length - 1]
    },
  }
}
