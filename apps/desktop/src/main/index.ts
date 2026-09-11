import { renameSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import {
  assessStartup,
  createCore,
  createFileLogSink,
  createRealScheduler,
  type AuthState,
  type EditEvent,
  type PeaksStatusChange,
  type RebuildProgress,
  type StagingStatusChange,
} from '../core'
import { HttpFreesoundGateway } from '../core/gateway/http'
import { CHANNELS } from '../shared/channels'
import { createElectronAuthPlatform } from './authPlatform'
import { createElectronDragHost } from './dragHost'
import { getOrCreateInstallId } from './installId'
import { createErrorTelemetry } from './errorTelemetry'
import { createFfmpegAudioRenderRunner } from './ffmpegRunner'
import { broadcaster } from './broadcast'
import { loadConfig } from './config'
import { registerIpc } from './ipc'
import { resolveDragIconPath, resolveFfmpegPath } from './paths'
import { registerWillQuitHandler } from './quit'
import { createWindow } from './window'

void app.whenReady().then(() => {
  const config = loadConfig()
  const dataDir = app.getPath('userData')
  const dbPath = join(dataDir, 'library.db')

  const startup = assessStartup({ dbPath, dataDir })
  if (!startup.db.ok && startup.db.reason === 'unreadable') {
    try {
      renameSync(dbPath, `${dbPath}.corrupt-${Date.now()}`)
    } catch {
      // If we cannot move it, `openDb` will throw and Electron will surface it —
      // still better than silently continuing on a corrupt file.
    }
  }

  const dragIconFallbackPath = resolveDragIconPath()
  const ffmpegPath = resolveFfmpegPath()

  const installId = config.telemetryEnabled
    ? getOrCreateInstallId(dataDir)
    : undefined

  const errorTelemetry = createErrorTelemetry({
    reportUrl: config.tokenWorkerUrl,
    enabled: config.telemetryEnabled,
    context: {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      osRelease: release(),
    },
  })

  const core = createCore({
    gateway: new HttpFreesoundGateway({
      tokenWorkerUrl: config.tokenWorkerUrl,
      installId,
    }),
    dataDir,
    dbPath,
    logSink: createFileLogSink(join(dataDir, 'logs')),
    telemetry: errorTelemetry,
    authPlatform: createElectronAuthPlatform(),
    scheduler: createRealScheduler(),
    clientId: config.freesoundClientId,
    onAuthStateChange: broadcaster<AuthState>(CHANNELS.authState),
    onStagingStatusChange: broadcaster<StagingStatusChange>(
      CHANNELS.stagingStatus,
    ),
    onPeaksStatusChange: broadcaster<PeaksStatusChange>(CHANNELS.peaksStatus),
    onRebuildProgress: broadcaster<RebuildProgress>(CHANNELS.rebuildProgress),
    onEditProgress: broadcaster<EditEvent>(CHANNELS.editProgress),
    peakWorkerPath: join(__dirname, 'peakWorker.js'),
    rebuildWorkerPath: join(__dirname, 'rebuildWorker.js'),
    dragHost: createElectronDragHost({
      getWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
      fallbackIconPath: dragIconFallbackPath,
    }),
    dragIconFallbackPath,
    audioRenderRunner: ffmpegPath
      ? createFfmpegAudioRenderRunner(ffmpegPath)
      : undefined,
  })

  registerIpc(core)

  app.on('browser-window-created', (_e, win) => {
    win.webContents.on('did-finish-load', () => {
      win.webContents.send(CHANNELS.authState, core.getAuthState())
      if (startup.offerRebuild) {
        win.webContents.send(CHANNELS.rebuildOffer, {
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

  registerWillQuitHandler(app, errorTelemetry, core)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
