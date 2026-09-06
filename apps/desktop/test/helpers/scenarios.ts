import {
  createRecordingDragHost,
  type AudioRenderRunner,
  type Core,
  type RecordingDragHost,
} from '../../src/core'
import type { DB } from '../../src/core/db/index'
import { upsertSound } from '../../src/core/db/sounds'
import { upsertStagedEntry } from '../../src/core/db/staged'
import { writeOriginal } from '../../src/core/staging/contentStore'
import { FakeFreesoundGateway } from '../../src/core/gateway/fake'
import type { FreesoundGateway } from '../../src/core/gateway/index'
import type { Sound } from '../../src/core/types'
import { waitUntil } from './async'
import { deleteDatabaseFiles } from './db'
import { deadGateway } from './gateways'
import {
  makeTestCore,
  type MakeTestCoreOptions,
  type TestCore,
} from './makeTestCore'
import { fakeSound, RAIN } from './sounds'

/**
 * The normal running state: signed in, with staging consent granted. Pass
 * `{ consent: false }` for the state a user is in before the first-run notice.
 */
export async function signedInCore<
  G extends FreesoundGateway = FakeFreesoundGateway,
>(
  opts: MakeTestCoreOptions<G> = {},
  { consent = true }: { consent?: boolean } = {},
): Promise<TestCore<G>> {
  const tc = await makeTestCore(opts)
  await tc.core.signIn()
  if (consent) tc.core.grantStagingConsent()
  return tc
}

/** A core with no network at all — everything it does is served from disk. */
export function offlineCore(
  opts: Omit<MakeTestCoreOptions<FreesoundGateway>, 'gateway'> = {},
): Promise<TestCore<FreesoundGateway>> {
  return makeTestCore<FreesoundGateway>({ ...opts, gateway: deadGateway() })
}

/**
 * An offline core with each Sound seeded on disk and saved to the Library.
 * A plain id stands for `fakeSound(id)`.
 */
export async function offlineCoreWithLibrary(
  sounds: Array<number | Sound>,
  opts: Omit<MakeTestCoreOptions<FreesoundGateway>, 'gateway'> = {},
): Promise<TestCore<FreesoundGateway>> {
  const tc = await offlineCore(opts)
  for (const s of sounds) {
    await seedLibrarySound(
      tc.core,
      tc.dataDir,
      typeof s === 'number' ? fakeSound(s) : s,
    )
  }
  return tc
}

/**
 * A signed-in, consenting core wired to a recording `DragHost`, with the rain
 * fixture page already searched so its Sounds can be staged.
 */
export async function dragCore(
  opts: {
    multiFileDragSupported?: boolean
    audioRenderRunner?: AudioRenderRunner
  } = {},
): Promise<TestCore<FakeFreesoundGateway> & { host: RecordingDragHost }> {
  const host = createRecordingDragHost({
    multiFileDragSupported: opts.multiFileDragSupported ?? false,
  })
  const tc = await signedInCore({
    dragHost: host,
    audioRenderRunner: opts.audioRenderRunner,
  })
  await tc.core.search('rain')
  return { ...tc, host: host as RecordingDragHost }
}

/** Audition-stage a Sound and wait for its Original to land on disk. */
export async function stageReady(
  core: Core,
  id: number,
  timeoutMs?: number,
): Promise<void> {
  core.stageOnAudition(id)
  await waitUntil(() => core.getStagingStatus([id])[id] === 'ready', timeoutMs)
}

/**
 * Sign in, run `query`, and download `soundId` into the Library — how a test
 * gets a real Original (and so an Edit's parent) onto disk.
 */
export async function signInAndDownload(
  core: Core,
  soundId: number = RAIN.id,
  query = 'rain',
): Promise<void> {
  await core.signIn()
  await core.search(query)
  core.downloadToLibrary(soundId)
  await waitUntil(() => core.getStagingStatus([soundId])[soundId] === 'ready')
}

/** Write `sound`'s Original + sidecar to disk, with nothing in the database yet. */
export async function seedOriginal(
  dataDir: string,
  sound: Sound,
  bytes = `ORIG-${sound.id}`,
): Promise<void> {
  await writeOriginal(
    dataDir,
    sound,
    new TextEncoder().encode(bytes),
    Date.now(),
  )
}

/** A `sounds` metadata row plus its Original on disk — not Staged, not saved. */
export async function seedSoundRow(
  db: DB,
  dataDir: string,
  sound: Sound,
  bytes?: string,
): Promise<Sound> {
  upsertSound(db, sound)
  await seedOriginal(dataDir, sound, bytes)
  return sound
}

/** Write `sound`'s Original + sidecar to disk and save it to the Library. */
export async function seedLibrarySound(
  core: Core,
  dataDir: string,
  sound: Sound,
  bytes?: string,
): Promise<void> {
  await seedOriginal(dataDir, sound, bytes)
  core.saveToLibrary(sound.id, sound)
}

/**
 * A Staged Sound crafted directly in the database: a `sounds` row, a real
 * Original + sidecar on disk, and a `staged_entries` row with a chosen size and
 * last-accessed time — which is what eviction order is decided from.
 */
export async function craftStaged(
  db: DB,
  dataDir: string,
  sound: Sound,
  {
    bytes = 60,
    lastAccess = Date.now(),
  }: { bytes?: number | Uint8Array; lastAccess?: number } = {},
): Promise<{
  sound: Sound
  original: string
  sidecar: string
  byteSize: number
}> {
  upsertSound(db, sound)
  const body = typeof bytes === 'number' ? new Uint8Array(bytes) : bytes
  const { byteSize, paths } = await writeOriginal(
    dataDir,
    sound,
    body,
    lastAccess,
  )
  upsertStagedEntry(db, {
    soundId: sound.id,
    byteSize,
    path: paths.original,
    now: lastAccess,
  })
  return { sound, original: paths.original, sidecar: paths.sidecar, byteSize }
}

/**
 * Lose the database: close `tc`'s core, delete the SQLite files, and open a
 * fresh core on the same data dir — the state a rebuild has to recover from.
 */
export async function reopenWithoutDatabase(tc: {
  core: Core
  dbPath: string
  dataDir: string
}): Promise<TestCore> {
  tc.core.close()
  deleteDatabaseFiles(tc.dbPath)
  return makeTestCore({ dbPath: tc.dbPath, dataDir: tc.dataDir })
}
