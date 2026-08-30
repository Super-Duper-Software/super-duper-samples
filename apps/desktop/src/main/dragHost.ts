// The production `DragHost` (ticket 09): the one place `webContents.startDrag`
// is called. Everything upstream — resolving the Sound, hardlinking the Original
// under a human name, refusing an unstaged Sound — is in `src/core`; this is a
// thin adapter over the Electron API, exactly as CONVENTIONS.md requires.

import { existsSync } from 'node:fs'
import { BrowserWindow, nativeImage } from 'electron'
import type { DragHost, DragPayload } from '../core'

export interface ElectronDragHostDeps {
  /** The window the drag originates from. Single-window app → the first window. */
  getWindow: () => BrowserWindow | null
  /** Bundled fallback icon path, used if the renderer's waveform icon won't load. */
  fallbackIconPath: string
}

export function createElectronDragHost(deps: ElectronDragHostDeps): DragHost {
  // Ticket 01 findings §2.2 / §C: a multi-path `startDrag` delivers every file
  // on macOS, but Windows Explorer drops all but one (electron#9019). Until the
  // manual §C matrix says otherwise, multi-file drag is macOS-only.
  const multiFileDragSupported = process.platform === 'darwin'

  return {
    multiFileDragSupported,

    startDrag(payload: DragPayload): void {
      const win = deps.getWindow()
      if (!win || win.isDestroyed()) {
        throw new Error('startDrag: no live window to originate the drag from')
      }

      // The icon is mandatory and must be non-empty — on macOS `startDrag`
      // throws synchronously otherwise (ticket 01 findings §2.3). Prefer the
      // renderer's per-Sound waveform; fall back to the bundled glyph; treat
      // "both empty" as a hard error rather than a silent no-op.
      let icon = nativeImage.createFromPath(payload.iconPath)
      if (icon.isEmpty() && existsSync(deps.fallbackIconPath)) {
        icon = nativeImage.createFromPath(deps.fallbackIconPath)
      }
      if (icon.isEmpty()) {
        throw new Error(
          `startDrag: drag icon at ${payload.iconPath} loaded empty and the ` +
            `bundled fallback (${deps.fallbackIconPath}) is unusable`,
        )
      }

      const item =
        payload.extraFilePaths.length > 0
          ? {
              file: payload.filePath,
              files: [payload.filePath, ...payload.extraFilePaths],
              icon,
            }
          : { file: payload.filePath, icon }

      win.webContents.startDrag(item)
    },
  }
}
