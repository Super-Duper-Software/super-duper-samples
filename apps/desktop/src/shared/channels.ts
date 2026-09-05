/**
 * IPC channel names shared by the main process (which sends) and the preload
 * bridge (which subscribes). One definition so the two can never drift.
 */
export const CHANNELS = {
  authState: 'core:event:authState',
  stagingStatus: 'core:event:stagingStatus',
  peaksStatus: 'core:event:peaksStatus',
  /** A "your database is gone — rebuild?" offer, pushed once on startup. */
  rebuildOffer: 'core:event:rebuildOffer',
  rebuildProgress: 'core:event:rebuildProgress',
  editProgress: 'core:event:editProgress',
} as const

export type EventChannel = (typeof CHANNELS)[keyof typeof CHANNELS]
