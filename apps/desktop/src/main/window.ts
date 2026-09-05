import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  type Core,
  type WindowBounds,
} from '../core'

const DEFAULT_WINDOW = { width: 960, height: 720 }
const PERSIST_DEBOUNCE_MS = 400

/**
 * Clamp stored bounds to something visible: at least the minimum size, and with
 * the top-left corner on some currently-attached display (a monitor unplugged
 * since the last run must not strand the window offscreen).
 */
export function usableBounds(stored: WindowBounds | undefined): WindowBounds {
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

/** Write the window's current geometry into the persisted shell state. */
function saveBounds(win: BrowserWindow, core: Core): void {
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
}

export function createWindow(core: Core): void {
  const bounds = usableBounds(core.getUiState().window)

  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    ...(bounds.x !== undefined && bounds.y !== undefined
      ? { x: bounds.x, y: bounds.y }
      : {}),
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

  const devUrl = process.env['ELECTRON_RENDERER_URL']

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!devUrl || url !== devUrl) event.preventDefault()
  })

  let saveTimer: NodeJS.Timeout | undefined
  const persistBounds = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveBounds(win, core), PERSIST_DEBOUNCE_MS)
  }
  win.on('resize', persistBounds)
  win.on('move', persistBounds)
  win.on('maximize', persistBounds)
  win.on('unmaximize', persistBounds)
  win.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveBounds(win, core)
  })

  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
