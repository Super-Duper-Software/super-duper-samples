export type { Core, CoreDeps } from './api'
export type {
  ClientErrorEvent,
  ErrorEventCode,
  ErrorTelemetrySink,
} from './telemetry'
export type { FreesoundGateway } from './gateway/index'
export * from './types'

export {
  AuthError,
  DiskError,
  GatewayError,
  NetworkError,
  NotImplemented,
  NotSignedInError,
  ThrottledError,
  DEFAULT_RETRY_AFTER_SECONDS,
  classifyError,
} from './errors'
export type { ClassifiedError, ErrorKind } from './errors'

export {
  createFileLogSink,
  createLogger,
  formatLogLine,
  NULL_LOG_SINK,
  LOG_ROTATE_BYTES,
} from './logging/logger'
export type { Logger, LogLevel, LogSink } from './logging/logger'

export {
  EMPTY_UI_STATE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  mergeUiState,
  normaliseUiState,
} from './uiState'
export type { ShellView, UiState, WindowBounds } from './uiState'

export {
  createRealScheduler,
  LoopbackPortInUseError,
  OAuthStateMismatchError,
  ReauthRequiredError,
  RetryableTokenError,
  SignInCancelledError,
} from './auth/index'
export type {
  AuthPlatform,
  AuthState,
  AuthStatus,
  AwaitLoopbackCodeOptions,
  LoopbackResult,
  Scheduler,
} from './auth/index'

export {
  DOWNLOAD_CONCURRENCY,
  DOWNLOAD_MAX_RETRIES,
  DOWNLOAD_RETRY_BACKOFF_MS,
} from './staging/stagingController'
export type {
  StagingConsent,
  StagingStatus,
  StagingStatusChange,
} from './staging/stagingController'

export { OriginalNotStagedError } from './staging/dragController'
export type {
  DragController,
  DragStartResult,
  StartDragOptions,
} from './staging/dragController'
export {
  createRecordingDragHost,
  type DragHost,
  type DragPayload,
  type RecordingDragHost,
} from './staging/dragHost'
export {
  DEFAULT_STAGING_BYTE_BUDGET,
  type DiskUsage,
  type EvictionOutcome,
} from './staging/eviction'

export type { LibrarySort, SortDir } from './db/library'
export { inspectDbHealth } from './db/index'
export type { DbHealth } from './db/index'

export {
  createPeakService,
  workerRunner as createPeakWorkerRunner,
} from './peaks/peakService'
export type {
  PeakRunner,
  PeaksPayload,
  PeaksStatus,
  PeaksStatusChange,
} from './peaks/peakService'
export { BASE_BUCKET_COUNT } from './peaks/computePeaks'
export { decodeAudioBuffer, UndecodableAudioError } from './peaks/decodeAudio'
export { computePeaks } from './peaks/computePeaks'

export { assessStartup, countSidecars } from './startup/assessStartup'
export type { StartupAssessment } from './startup/assessStartup'

export {
  createRebuildService,
  rebuildWorkerRunner as createRebuildWorkerRunner,
  scanSidecars,
  NOT_RECOVERABLE_MESSAGE,
} from './rebuild/rebuildService'
export type {
  RebuildProgress,
  RebuildReport,
  RebuildRecovered,
  RebuildRunner,
  RebuildService,
  SidecarScan,
  ScannedSidecar,
  MalformedSidecar,
} from './rebuild/rebuildService'

export { pickEditName } from './edits/editName'
export { resolveTrim, InvalidTrimError } from './edits/trim'
export type {
  AudioRenderInput,
  AudioRenderResult,
  AudioRenderRunner,
  EditEvent,
} from './edits/editService'

export { buildManifest } from './manifest/buildManifest'
export type {
  Manifest,
  ManifestEntry,
  ManifestSummary,
  ManifestInput,
  ManifestSourceSound,
} from './manifest/buildManifest'
export {
  requiresAttribution,
  restrictsCommercialUse,
} from './manifest/obligations'
