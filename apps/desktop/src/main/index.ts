// Electron main process — a THIN adapter. It constructs the core, wires the core's
// command API to IPC, and does nothing else. No business logic lives here
// (CONVENTIONS.md, spec 0001: "If a behaviour cannot be exercised without
// launching Electron, it is in the wrong place.").

import { existsSync, renameSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import {
  assessStartup,
  createCore,
  createFileLogSink,
  createRealScheduler,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  type AuthState,
  type Core,
  type PeaksStatusChange,
  type RebuildProgress,
  type StagingStatusChange,
  type WindowBounds,
} from '../core'
import { HttpFreesoundGateway } from '../core/gateway/http'
import { createElectronAuthPlatform } from './authPlatform'
import { createElectronDragHost } from './dragHost'
import { loadConfig } from './config'

/**
 * The bundled fallback drag icon (ticket 09). In the electron-vite `out/` layout
 * `__dirname` is `out/main`, so the committed `resources/` dir sits two levels
 * up; a packaged build (ticket 19) will ship it under `process.resourcesPath`.
 */
function resolveDragIconPath(): string {
  const candidates = [
    join(__dirname, '../../resources/drag-icon.png'),
    process.resourcesPath ? join(process.resourcesPath, 'drag-icon.png') : '',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!
}

/** Channel the renderer listens on for auth-state pushes (ticket 07). */
const AUTH_STATE_CHANNEL = 'core:event:authState'
/** Channel the renderer listens on for per-sound staging status pushes (ticket 08). */
const STAGING_STATUS_CHANNEL = 'core:event:stagingStatus'
/** Channel the renderer listens on for per-sound computed-peaks status pushes (ticket 12). */
const PEAKS_STATUS_CHANNEL = 'core:event:peaksStatus'
/** Channel the main process pushes a "your database is gone — rebuild?" offer on (ticket 14). */
const REBUILD_OFFER_CHANNEL = 'core:event:rebuildOffer'
/** Channel the main process pushes sidecar-scan progress on during a rebuild (ticket 14). */
const REBUILD_PROGRESS_CHANNEL = 'core:event:rebuildProgress'

const DEFAULT_WINDOW = { width: 960, height: 720 }

/**
 * Clamp stored bounds to something visible: at least the minimum size, and with
 * the top-left corner on some currently-attached display (a monitor that was
 * unplugged since last run must not strand the window offscreen).
 */
function usableBounds(stored: WindowBounds | undefined): WindowBounds {
  if (!stored) return { ...DEFAULT_WINDOW }
  const width = Math.max(MIN_WINDOW_WIDTH, stored.width)
  const height = Math.max(MIN_WINDOW_HEIGHT, stored.height)
  if (stored.x === undefined || stored.y === undefined) {
    return { width, height, maximized: stored.maximized }
  }
  const onScreen = screen.getAllDisplays().some((d) => {
    const wa = d.workArea
    return (
      stored.x! >= wa.x - 8 &&
      stored.y! >= wa.y - 8 &&
      stored.x! < wa.x + wa.width - 40 &&
      stored.y! < wa.y + wa.height - 40
    )
  })
  return onScreen
    ? { width, height, x: stored.x, y: stored.y, maximized: stored.maximized }
    : { width, height, maximized: stored.maximized }
}

function createWindow(core: Core): void {
  const bounds = usableBounds(core.getUiState().window)

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(bounds.x !== undefined && bounds.y !== undefined
      ? { x: bounds.x, y: bounds.y }
      : {}),
    // Ticket 18 — no white flash and no blank frame while the renderer boots:
    // paint on the app's own dark ground and only reveal the window once React
    // has something to show.
    show: false,
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (bounds.maximized) win.maximize()
  win.once('ready-to-show', () => win.show())

  // Persist size/position as the user leaves them. Debounced so a drag-resize
  // does not write on every frame; `setUiState` merges, so this only ever
  // touches the `window` key.
  let saveTimer: NodeJS.Timeout | undefined
  const persistBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (win.isDestroyed()) return
      const b = win.getBounds()
      core.setUiState({
        window: {
          width: b.width,
          height: b.height,
          x: b.x,
          y: b.y,
          maximized: win.isMaximized(),
        },
      })
    }, 400)
  }
  win.on('resize', persistBounds)
  win.on('move', persistBounds)
  win.on('maximize', persistBounds)
  win.on('unmaximize', persistBounds)
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    if (win.isDestroyed()) return
    const b = win.getBounds()
    core.setUiState({
      window: {
        width: b.width,
        height: b.height,
        x: b.x,
        y: b.y,
        maximized: win.isMaximized(),
      },
    })
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(core: Core): void {
  // Named channel for the one command this ticket ships.
  ipcMain.handle('core:search', (_event, query: string, opts?: unknown) =>
    core.search(query, opts as Parameters<Core['search']>[1]),
  )

  // Two named channels for the ticket-11 actions that need Electron `shell` —
  // which cannot live in the core. The core supplies pure data (a file path, a
  // URL); `shell.*` is the only Electron-only step and happens here.
  ipcMain.handle('core:revealInFinder', (_event, soundId: number) => {
    const path = core.getContentPath(soundId)
    if (path) shell.showItemInFolder(path)
  })
  ipcMain.handle('core:openExternal', (_event, soundId: number) => {
    const url = core.getFreesoundUrl(soundId)
    if (url) return shell.openExternal(url)
  })

  // Ticket 18 — reveal the app's own log file so a user filing a bug can attach
  // it. `shell` cannot live in core; the core supplies only the path.
  ipcMain.handle('core:showLogs', () => {
    const path = core.getLogPath()
    if (path && existsSync(path)) shell.showItemInFolder(path)
    else void shell.openPath(join(app.getPath('userData'), 'logs'))
  })

  // Ticket 17 — write an Attribution Manifest to a file the user picks. The core
  // built the text; the native Save dialog and the disk write are the only
  // Electron-only steps, so they happen here.
  ipcMain.handle(
    'core:saveManifest',
    async (_event, defaultFileName: string, text: string) => {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
      const result = await (win
        ? dialog.showSaveDialog(win, {
            defaultPath: defaultFileName,
            filters: [{ name: 'Text', extensions: ['txt'] }],
          })
        : dialog.showSaveDialog({
            defaultPath: defaultFileName,
            filters: [{ name: 'Text', extensions: ['txt'] }],
          }))
      if (result.canceled || !result.filePath) return { saved: false }
      await writeFile(result.filePath, text, 'utf8')
      return { saved: true, path: result.filePath }
    },
  )

  // Generic passthrough so later commands need no main-process change. This
  // already covers `signIn` / `signOut` / `getAuthState`.
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

function broadcastAuthState(state: AuthState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(AUTH_STATE_CHANNEL, state)
  }
}

function broadcastStagingStatus(change: StagingStatusChange): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(STAGING_STATUS_CHANNEL, change)
  }
}

function broadcastPeaksStatus(change: PeaksStatusChange): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(PEAKS_STATUS_CHANNEL, change)
  }
}

function broadcastRebuildProgress(progress: RebuildProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(REBUILD_PROGRESS_CHANNEL, progress)
  }
}

void app.whenReady().then(() => {
  const config = loadConfig()
  const dataDir = app.getPath('userData')
  const dbPath = join(dataDir, 'library.db') // opened in the core, off the renderer thread.

  // Ticket 14 — check the database BEFORE the core opens it. If it is missing,
  // corrupt or half-migrated but there are sidecars on disk, we offer the user a
  // rebuild instead of launching into an empty Library. A file that exists but
  // cannot be opened is moved aside so `openDb` can start a fresh schema; the
  // rebuild then repopulates it.
  const startup = assessStartup({ dbPath, dataDir })
  if (!startup.db.ok && startup.db.reason === 'unreadable') {
    try {
      renameSync(dbPath, `${dbPath}.corrupt-${Date.now()}`)
    } catch {
      // If we cannot move it, `openDb` will throw and Electron will surface it —
      // still better than silently continuing on a corrupt file.
    }
  }

  const gateway = new HttpFreesoundGateway({
    apiKey: config.freesoundApiKey,
    tokenWorkerUrl: config.tokenWorkerUrl,
  })
  const dragIconFallbackPath = resolveDragIconPath()
  const core = createCore({
    gateway,
    dataDir,
    dbPath,
    // Ticket 18 — the app's own log, under <userData>/logs/app.log. Every error
    // the renderer surfaces is also written here for bug reports.
    logSink: createFileLogSink(join(dataDir, 'logs')),
    authPlatform: createElectronAuthPlatform(),
    scheduler: createRealScheduler(),
    clientId: config.freesoundClientId,
    onAuthStateChange: broadcastAuthState,
    onStagingStatusChange: broadcastStagingStatus,
    onPeaksStatusChange: broadcastPeaksStatus,
    onRebuildProgress: broadcastRebuildProgress,
    // The peak Worker is built as a second `main` entry (electron.vite.config.ts),
    // so it sits next to this compiled bundle at `out/main/peakWorker.js`.
    peakWorkerPath: join(__dirname, 'peakWorker.js'),
    // The sidecar-scan Worker for "rebuild from sidecars" (ticket 14), built as a
    // third `main` entry — `out/main/rebuildWorker.js`.
    rebuildWorkerPath: join(__dirname, 'rebuildWorker.js'),
    dragHost: createElectronDragHost({
      getWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
      fallbackIconPath: dragIconFallbackPath,
    }),
    dragIconFallbackPath,
  })

  registerIpc(core)

  // Push the current auth state to each window as it finishes loading, so the
  // renderer never has to poll on startup. Registered BEFORE the first window.
  app.on('browser-window-created', (_e, win) => {
    win.webContents.on('did-finish-load', () => {
      win.webContents.send(AUTH_STATE_CHANNEL, core.getAuthState())
      // Ticket 14 — if the database was unusable and there are sidecars, tell the
      // renderer to offer a rebuild (with the "custom names / tags / Collections
      // are not recoverable" warning) rather than show an empty Library.
      if (startup.offerRebuild) {
        win.webContents.send(REBUILD_OFFER_CHANNEL, {
          reason: startup.db.ok ? null : startup.db.reason,
          sidecarCount: startup.sidecarCount,
          notRecoverable: startup.notRecoverable,
        })
      }
    })
  })

  createWindow(core)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(core)
  })

  app.on('will-quit', () => core.close())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
