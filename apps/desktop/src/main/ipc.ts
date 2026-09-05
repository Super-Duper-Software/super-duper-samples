import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { Core } from '../core'

const SUPPORT_PAGE = 'https://ko-fi.com/sparlos'
const SUPPORT_EMAIL = 'info@superdupersoftware.net'

function mailtoUrl(opts?: { subject?: string; body?: string }): string {
  const parts: string[] = []
  if (opts?.subject) parts.push(`subject=${encodeURIComponent(opts.subject)}`)
  if (opts?.body) parts.push(`body=${encodeURIComponent(opts.body)}`)
  const query = parts.join('&')
  return `mailto:${SUPPORT_EMAIL}${query ? `?${query}` : ''}`
}

/**
 * The IPC surface. `core:invoke` forwards any `Core` command verbatim; the
 * named channels are the handful of things the core cannot do for itself
 * because they need Electron (`shell`, `dialog`).
 */
export function registerIpc(core: Core): void {
  ipcMain.handle('core:search', (_event, query: string, opts?: unknown) =>
    core.search(query, opts as Parameters<Core['search']>[1]),
  )

  ipcMain.handle('core:revealInFinder', (_event, soundId: number) => {
    const path = core.getContentPath(soundId)
    if (path) shell.showItemInFolder(path)
  })

  ipcMain.handle('core:openExternal', (_event, soundId: number) => {
    const url = core.getFreesoundUrl(soundId)
    if (url) return shell.openExternal(url)
  })

  ipcMain.handle('core:openSupportPage', () => shell.openExternal(SUPPORT_PAGE))

  ipcMain.handle(
    'core:openSupportEmail',
    (_event, opts?: { subject?: string; body?: string }) =>
      shell.openExternal(mailtoUrl(opts)),
  )

  ipcMain.handle('core:showLogs', () => {
    const path = core.getLogPath()
    if (path && existsSync(path)) shell.showItemInFolder(path)
    else void shell.openPath(join(app.getPath('userData'), 'logs'))
  })

  ipcMain.handle(
    'core:saveManifest',
    async (_event, defaultFileName: string, text: string) => {
      const win =
        BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const options = {
        defaultPath: defaultFileName,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      }
      const result = await (win
        ? dialog.showSaveDialog(win, options)
        : dialog.showSaveDialog(options))
      if (result.canceled || !result.filePath) return { saved: false }
      await writeFile(result.filePath, text, 'utf8')
      return { saved: true, path: result.filePath }
    },
  )

  ipcMain.handle(
    'core:invoke',
    (_event, method: string, args: unknown[] = []) => {
      const fn = (core as unknown as Record<string, unknown>)[method]
      if (typeof fn !== 'function') {
        throw new Error(`unknown core command: ${method}`)
      }
      return (fn as (...a: unknown[]) => unknown)(...args)
    },
  )
}
