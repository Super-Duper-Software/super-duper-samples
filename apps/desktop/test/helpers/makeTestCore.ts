import { mkdtemp } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCore, type Core, type StagingStatusChange } from '../../src/core'
import { FakeFreesoundGateway } from '../../src/core/gateway/fake'
import type { FreesoundGateway, RawSearchPage } from '../../src/core/gateway/index'
import { FakeAuthPlatform } from './fakeAuthPlatform'
import { FakeScheduler } from './fakeScheduler'

const fixturesDir = fileURLToPath(
  new URL('../fixtures/freesound/', import.meta.url),
)

/** Load a recorded gateway fixture by filename. */
export function loadFixture(name: string): RawSearchPage {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')) as RawSearchPage
}

/** A fake gateway pre-loaded with the committed fixtures. */
export function makeFakeGateway(
  overrides: Partial<ConstructorParameters<typeof FakeFreesoundGateway>[0]> = {},
): FakeFreesoundGateway {
  return new FakeFreesoundGateway({
    pages: {
      rain: loadFixture('search-rain.json'),
      thunder: loadFixture('search-thunder.json'),
    },
    pagedPages: {
      // A two-page fixture (count 6): use with `{ pageSize: 3 }` to walk pages.
      loops: [loadFixture('search-loops-p1.json'), loadFixture('search-loops-p2.json')],
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
    onStagingStatusChange?: (change: StagingStatusChange) => void
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
    onStagingStatusChange: opts.onStagingStatusChange,
  })
  return { core, gateway, authPlatform, scheduler, dataDir, dbPath }
}
