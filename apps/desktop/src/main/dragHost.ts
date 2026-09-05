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
  const multiFileDragSupported = process.platform === 'darwin'

  return {
    multiFileDragSupported,

    startDrag(payload: DragPayload): void {
      const win = deps.getWindow()
      if (!win || win.isDestroyed()) {
        throw new Error('startDrag: no live window to originate the drag from')
      }

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
