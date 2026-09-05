import type { Core, CoreDeps } from './api'
import {
  createLogger,
  NULL_LOG_SINK,
  type Logger,
} from './logging/logger'
import { mergeUiState } from './uiState'
import { openDb, type DB } from './db/index'
import { assessStartup } from './startup/assessStartup'
import {
  createRebuildService,
  type RebuildService,
} from './rebuild/rebuildService'
import { getSoundsByIds, upsertSound } from './db/sounds'
import { getEditFieldsByIds, deleteSoundRow } from './db/edits'
import {
  deleteLibraryEntry,
  hasLibraryEntry,
  libraryMembership,
  saveLibraryEntry,
  setCustomName as dbSetCustomName,
  setCustomTags as dbSetCustomTags,
} from './db/library'
import { createEditService, type EditService } from './edits/editService'
import {
  addMembers,
  clearSoundFromAllCollections,
  collectionsForSounds,
  deleteCollectionRow,
  getCollectionName,
  hasCollection,
  insertCollection,
  listCollectionSummaries,
  removeMember,
  updateCollectionName,
} from './db/collections'
import { buildManifest } from './manifest/buildManifest'
import { normaliseTags } from './library/libraryFilter'
import { readCollectionSounds, readLibrary } from './library/readLibrary'
import {
  contentPaths,
  isOriginalOnDisk,
  removeEditFiles,
  writeEditSidecarCustomName,
} from './staging/contentStore'
import { deletePeaksRecord } from './db/peaks'
import { createPeakService, type PeakService } from './peaks/peakService'
import { createSearchService } from './search/searchService'
import {
  createAuthController,
  createRealScheduler,
  type AuthController,
  type Scheduler,
} from './auth/index'
import { unconfiguredAuth } from './auth/unconfiguredAuth'
import {
  createStagingController,
  type StagingController,
} from './staging/stagingController'
import {
  createDragController,
  type DragController,
} from './staging/dragController'
import { createDragRegistry } from './staging/dragRegistry'
import { sweepDragDir } from './staging/sweepDragDir'
import {
  DEFAULT_STAGING_BYTE_BUDGET,
  removeContentFiles,
} from './staging/eviction'
import {
  readLibraryFilter,
  readSearchPrefs,
  readUiState,
  writeLibraryFilter,
  writeSearchPrefs,
  writeUiState,
} from './prefs'

const DEBOUNCE_MS = 320

export function createCore(deps: CoreDeps): Core {
  const { gateway, dbPath, dataDir, debounceMs = DEBOUNCE_MS } = deps

  const startupAssessment = assessStartup({ dbPath, dataDir })
  const db: DB = openDb(dbPath)
  const logger: Logger = createLogger(deps.logSink ?? NULL_LOG_SINK)

  sweepDragDir(dataDir, logger)

  const scheduler: Scheduler = deps.scheduler ?? createRealScheduler()

  const auth: AuthController =
    deps.authPlatform && deps.scheduler
      ? createAuthController({
          gateway,
          platform: deps.authPlatform,
          scheduler: deps.scheduler,
          db,
          clientId: deps.clientId ?? '',
          onStateChange: deps.onAuthStateChange,
        })
      : unconfiguredAuth(deps.onAuthStateChange)

  const dragRegistry = createDragRegistry()

  const peakService: PeakService = createPeakService({
    db,
    dataDir,
    peakWorkerPath: deps.peakWorkerPath,
    runner: deps.computePeaksRunner,
    audioRenderRunner: deps.audioRenderRunner,
    onStatusChange: deps.onPeaksStatusChange,
  })

  const rebuild: RebuildService = createRebuildService({
    db,
    dataDir,
    rebuildWorkerPath: deps.rebuildWorkerPath,
    runner: deps.rebuildRunner,
    onProgress: deps.onRebuildProgress,
  })

  const edits: EditService = createEditService({
    db,
    dataDir,
    runner: deps.audioRenderRunner,
    onEvent: deps.onEditProgress,
  })

  const staging: StagingController = createStagingController({
    db,
    dataDir,
    gateway,
    auth,
    scheduler,
    onStatusChange: (change) => {
      if (change.status === 'failed') {
        logger.warn('staged download failed', { soundId: change.soundId })
      }
      deps.onStagingStatusChange?.(change)
    },
    onOriginalReady: (soundId) => peakService.requestPeaks(soundId),
    byteBudget: deps.stagingByteBudget ?? DEFAULT_STAGING_BYTE_BUDGET,
    inFlightDrags: dragRegistry,
    concurrency: deps.stagingConcurrency,
    maxRetries: deps.stagingMaxRetries,
    backoffMs: deps.stagingBackoffMs,
  })

  const drag: DragController | undefined = deps.dragHost
    ? createDragController({
        db,
        dataDir,
        dragHost: deps.dragHost,
        fallbackIconPath: deps.dragIconFallbackPath,
        dragRegistry,
      })
    : undefined

  function requireDrag(): DragController {
    if (!drag) {
      throw new Error('Drag-out is not configured (no DragHost was provided).')
    }
    return drag
  }

  const search = createSearchService({
    db,
    gateway,
    auth,
    logger,
    debounceMs,
  })

  function requireLibraryEntry(command: string, soundId: number): void {
    if (!hasLibraryEntry(db, soundId)) {
      throw new Error(
        `${command}: sound ${soundId} is not in the Library — save it first`,
      )
    }
  }

  function mirrorEditName(soundId: number, name: string | null): void {
    const localPath = getEditFieldsByIds(db, [soundId]).get(soundId)?.localPath
    if (!localPath) return
    try {
      writeEditSidecarCustomName(localPath, name)
    } catch (err) {
      logger.warn('failed to mirror Edit name into its sidecar', {
        soundId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    search: (query, opts) => search.search(query, opts),
    searchDebounced: (query, opts) => search.searchDebounced(query, opts),
    getSearchPrefs: () => readSearchPrefs(db),
    setSearchPrefs: (prefs) => writeSearchPrefs(db, prefs),

    getUiState: () => readUiState(db),
    setUiState: (patch) =>
      writeUiState(db, mergeUiState(readUiState(db), patch ?? {})),
    getLogPath: () => logger.path(),
    readLog: (opts) => logger.read(opts?.maxLines ?? 500),
    log: (level, message, meta) => logger[level]?.(message, meta),

    signIn: () => auth.signIn(),
    signOut: () => auth.signOut(),
    getAuthState: () => auth.getState(),
    subscribeAuthState: (listener) => auth.subscribe(listener),

    stageOnAudition: (soundId) => staging.stageOnAudition(soundId),
    downloadToLibrary: (soundId, sound) =>
      staging.downloadToLibrary(soundId, sound),
    getDownloadsInLast24h: () => staging.getDownloadsInLast24h(),
    cancelStaging: (soundId) => staging.cancelStaging(soundId),
    getStagingStatus: (ids) => staging.getStagingStatus(ids),
    getStagingConsent: () => staging.getStagingConsent(),
    grantStagingConsent: () => staging.grantStagingConsent(),
    subscribeStagingStatus: (listener) => staging.subscribe(listener),

    startDrag: (soundIds, opts) => requireDrag().startDrag(soundIds, opts),
    getDragCapabilities: () => ({
      multiSound: drag?.multiSoundDragSupported ?? false,
    }),
    endDrag: (soundIds) =>
      dragRegistry.end(typeof soundIds === 'number' ? [soundIds] : soundIds),
    getDiskUsage: () => staging.getDiskUsage(),
    clearStaged: () => staging.clearStaged(),

    saveToLibrary: (soundId, sound, collectionIds) => {
      if (sound) upsertSound(db, sound)
      if (!getSoundsByIds(db, [soundId])[0]) {
        throw new Error(
          `saveToLibrary: no metadata for sound ${soundId} — search or audition it first`,
        )
      }
      const fileInto = collectionIds ?? []
      for (const cid of fileInto) {
        if (!hasCollection(db, cid)) {
          throw new Error(`saveToLibrary: no collection ${cid}`)
        }
      }
      const now = Date.now()
      db.transaction(() => {
        saveLibraryEntry(db, soundId, now)
        for (const cid of fileInto) addMembers(db, cid, [soundId], now)
      })()
    },
    getLibraryMembership: (ids) => libraryMembership(db, ids),
    listLibrary: (opts) => readLibrary(db, opts?.dir ?? 'desc'),
    filterLibrary: (filter, opts) =>
      readLibrary(db, opts?.dir ?? 'desc', filter),
    setCustomName: (soundId, customName) => {
      requireLibraryEntry('setCustomName', soundId)
      const trimmed = (customName ?? '').trim()
      const next = trimmed === '' ? null : trimmed
      dbSetCustomName(db, soundId, next)
      if (soundId < 0) mirrorEditName(soundId, next)
    },
    setLibraryTags: (soundId, tags) => {
      requireLibraryEntry('setLibraryTags', soundId)
      dbSetCustomTags(db, soundId, normaliseTags(tags))
    },
    getLibraryFilter: () => readLibraryFilter(db),
    setLibraryFilter: (filter) => writeLibraryFilter(db, filter),
    deleteFromLibrary: async (soundId) => {
      const isEdit = soundId < 0
      const sound = getSoundsByIds(db, [soundId])[0]
      const editLocalPath = isEdit
        ? getEditFieldsByIds(db, [soundId]).get(soundId)?.localPath
        : null
      db.transaction(() => {
        deleteLibraryEntry(db, soundId)
        clearSoundFromAllCollections(db, soundId)
        deletePeaksRecord(db, soundId)
        if (isEdit) deleteSoundRow(db, soundId)
      })()
      if (isEdit) {
        if (editLocalPath) await removeEditFiles(editLocalPath)
      } else if (sound) {
        await removeContentFiles(dataDir, sound)
      }
    },

    getPeaks: (soundId) => peakService.getPeaks(soundId),
    requestPeaks: (soundId) => peakService.requestPeaks(soundId),
    subscribePeaksStatus: (listener) => peakService.subscribe(listener),
    getContentPath: (soundId) => {
      if (soundId < 0) {
        return getEditFieldsByIds(db, [soundId]).get(soundId)?.localPath ?? null
      }
      const sound = getSoundsByIds(db, [soundId])[0]
      if (!sound || !isOriginalOnDisk(dataDir, sound)) return null
      return contentPaths(dataDir, sound).original
    },
    getFreesoundUrl: (soundId) => getSoundsByIds(db, [soundId])[0]?.url ?? null,

    createCollection: (name) => {
      const clean = name.trim()
      if (clean === '') throw new Error('createCollection: name is empty')
      return { id: insertCollection(db, clean, Date.now()), name: clean, count: 0 }
    },
    renameCollection: (collectionId, name) => {
      const clean = name.trim()
      if (clean === '') throw new Error('renameCollection: name is empty')
      updateCollectionName(db, collectionId, clean)
    },
    deleteCollection: (collectionId) => deleteCollectionRow(db, collectionId),
    addToCollection: (collectionId, soundIds) => {
      if (!hasCollection(db, collectionId)) {
        throw new Error(`addToCollection: no collection ${collectionId}`)
      }
      for (const id of soundIds) requireLibraryEntry('addToCollection', id)
      addMembers(db, collectionId, soundIds, Date.now())
    },
    removeFromCollection: (collectionId, soundId) =>
      removeMember(db, collectionId, soundId),
    listCollections: () => listCollectionSummaries(db),
    listCollectionSounds: (collectionId, opts) =>
      readCollectionSounds(db, collectionId, opts?.dir ?? 'desc'),
    getCollectionsForSounds: (soundIds) => collectionsForSounds(db, soundIds),
    generateManifest: (collectionId) => {
      const name = getCollectionName(db, collectionId)
      if (name === null) {
        throw new Error(`generateManifest: no collection ${collectionId}`)
      }
      const sounds = readCollectionSounds(db, collectionId, 'desc')

      const parentIds = sounds
        .map((s) => s.derivedFrom)
        .filter((id): id is number => id != null)
      const parentNameById = new Map(
        getSoundsByIds(db, parentIds).map((p) => [p.id, p.name]),
      )

      return buildManifest({
        collectionId,
        collectionName: name,
        generatedAt: Date.now(),
        sounds: sounds.map((s) =>
          s.derivedFrom != null && parentNameById.has(s.derivedFrom)
            ? { ...s, name: parentNameById.get(s.derivedFrom)! }
            : s,
        ),
      })
    },

    getStartupAssessment: () => startupAssessment,
    rebuildFromSidecars: () => rebuild.rebuildFromSidecars(),
    subscribeRebuildProgress: (listener) => rebuild.subscribe(listener),

    createEdit: (parentSoundId, spec) => edits.createEdit(parentSoundId, spec),
    cancelEdit: (parentSoundId) => edits.cancelEdit(parentSoundId),
    subscribeEditProgress: (listener) => edits.subscribe(listener),

    close: () => {
      search.close()
      staging.close()
      peakService.close()
      rebuild.close()
      edits.close()
      auth.close()
      dragRegistry.clear()
      db.close()
    },
  }
}
