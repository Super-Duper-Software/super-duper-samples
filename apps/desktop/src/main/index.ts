// Electron main process — a THIN adapter. It constructs the core, wires the core's
// command API to IPC, and does nothing else. No business logic lives here
// (CONVENTIONS.md, spec 0001: "If a behaviour cannot be exercised without
// launching Electron, it is in the wrong place.").

import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { createCore, createRealScheduler, type AuthState, type Core } from '../core'
import { HttpFreesoundGateway } from '../core/gateway/http'
import { createElectronAuthPlatform } from './authPlatform'
import { loadConfig } from './config'

/** Channel the renderer listens on for auth-state pushes (ticket 07). */
const AUTH_STATE_CHANNEL = 'core:event:authState'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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

void app.whenReady().then(() => {
  const config = loadConfig()
  const dataDir = app.getPath('userData')
  const dbPath = join(dataDir, 'library.db') // opened in the core, off the renderer thread.

  const gateway = new HttpFreesoundGateway({
    apiKey: config.freesoundApiKey,
    tokenWorkerUrl: config.tokenWorkerUrl,
  })
  const core = createCore({
    gateway,
    dataDir,
    dbPath,
    authPlatform: createElectronAuthPlatform(),
    scheduler: createRealScheduler(),
    clientId: config.freesoundClientId,
    onAuthStateChange: broadcastAuthState,
  })

  registerIpc(core)

  // Push the current auth state to each window as it finishes loading, so the
  // renderer never has to poll on startup. Registered BEFORE the first window.
  app.on('browser-window-created', (_e, win) => {
    win.webContents.on('did-finish-load', () => {
      win.webContents.send(AUTH_STATE_CHANNEL, core.getAuthState())
    })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('will-quit', () => core.close())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
