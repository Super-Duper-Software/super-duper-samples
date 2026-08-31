import { mkdtemp } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createCore,
  type Core,
  type DragHost,
  type PeakRunner,
  type PeaksStatusChange,
  type StagingStatusChange,
} from '../../src/core'
import { FakeFreesoundGateway } from '../../src/core/gateway/fake'
import type {
  FreesoundGateway,
  RawSearchPage,
} from '../../src/core/gateway/index'
import { FakeAuthPlatform } from './fakeAuthPlatform'
import { FakeScheduler } from './fakeScheduler'

/**
 * The committed bundled drag icon (ticket 09). Passed to every test core so the
 * drag controller has a non-empty fallback icon without a renderer in the loop.
 */
const DRAG_ICON_FALLBACK = fileURLToPath(
  new URL('../../resources/drag-icon.png', import.meta.url),
)

const fixturesDir = fileURLToPath(
  new URL('../fixtures/freesound/', import.meta.url),
)

/** Load a recorded gateway fixture by filename. */
export function loadFixture(name: string): RawSearchPage {
  return JSON.parse(
    readFileSync(join(fixturesDir, name), 'utf8'),
  ) as RawSearchPage
}

/** A fake gateway pre-loaded with the committed fixtures. */
export function makeFakeGateway(
  overrides: Partial<
    ConstructorParameters<typeof FakeFreesoundGateway>[0]
  > = {},
): FakeFreesoundGateway {
  return new FakeFreesoundGateway({
    pages: {
      rain: loadFixture('search-rain.json'),
      thunder: loadFixture('search-thunder.json'),
    },
    pagedPages: {
      // A two-page fixture (count 6): use with `{ pageSize: 3 }` to walk pages.
      loops: [
        loadFixture('search-loops-p1.json'),
        loadFixture('search-loops-p2.json'),
      ],
    },
    defaultPage: loadFixture('search-empty.json'),
    ...overrides,
  })
}

export interface TestCore {
  core: Core
  gateway: FreesoundGateway
  authPlatform: FakeAuthPlatform
  scheduler: FakeScheduler
  dataDir: string
  dbPath: string
  /** The `DragHost` the core was built with, if any (ticket 09). */
  dragHost?: DragHost
}

/**
 * Build the core in-process — no Electron. Real temp dir, real SQLite database,
 * fake gateway, fake `AuthPlatform` + `Scheduler`. This is the primary test seam
 * (spec 0001 § Testing Decisions).
 *
 * `dbPath` is returned so a test can spin up a SECOND `createCore` on the same
 * file and assert persistence. `debounceMs` defaults small so `searchDebounced`
 * tests do not wait 250ms.
 */
export async function makeTestCore(
  opts: {
    gateway?: FreesoundGateway
    dbPath?: string
    debounceMs?: number
    authPlatform?: FakeAuthPlatform
    scheduler?: FakeScheduler
    /** Ticket 08 — shrink the concurrency cap / backoff for staging tests. */
    stagingConcurrency?: number
    stagingMaxRetries?: number
    stagingBackoffMs?: readonly number[]
    /** Ticket 10 — shrink the staging byte budget so eviction tests can trip it. */
    stagingByteBudget?: number
    onStagingStatusChange?: (change: StagingStatusChange) => void
    /** Ticket 09 — a recording `DragHost` so a test can see what is dragged. */
    dragHost?: DragHost
    /** Ticket 12 — in-process peak runner so tests never spawn a real Worker. */
    computePeaksRunner?: PeakRunner
    peakWorkerPath?: string
    onPeaksStatusChange?: (change: PeaksStatusChange) => void
  } = {},
): Promise<TestCore> {
  const dataDir = await mkdtemp(join(tmpdir(), 'freesound-desktop-test-'))
  const dbPath = opts.dbPath ?? join(dataDir, 'library.db')
  const gateway = opts.gateway ?? makeFakeGateway()
  const authPlatform = opts.authPlatform ?? new FakeAuthPlatform()
  const scheduler = opts.scheduler ?? new FakeScheduler()
  const core = createCore({
    gateway,
    dataDir,
    dbPath,
    debounceMs: opts.debounceMs ?? 20,
    authPlatform,
    scheduler,
    clientId: 'test-client-id',
    stagingConcurrency: opts.stagingConcurrency,
    stagingMaxRetries: opts.stagingMaxRetries,
    stagingBackoffMs: opts.stagingBackoffMs,
    stagingByteBudget: opts.stagingByteBudget,
    onStagingStatusChange: opts.onStagingStatusChange,
    dragHost: opts.dragHost,
    dragIconFallbackPath: DRAG_ICON_FALLBACK,
    computePeaksRunner: opts.computePeaksRunner,
    peakWorkerPath: opts.peakWorkerPath,
    onPeaksStatusChange: opts.onPeaksStatusChange,
  })
  return {
    core,
    gateway,
    authPlatform,
    scheduler,
    dataDir,
    dbPath,
    dragHost: opts.dragHost,
  }
}
