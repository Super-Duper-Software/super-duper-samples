import { mkdtemp } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCore, type Core } from '../../src/core'
import { FakeFreesoundGateway } from '../../src/core/gateway/fake'
import type { FreesoundGateway, RawSearchPage } from '../../src/core/gateway/index'

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
    defaultPage: loadFixture('search-empty.json'),
    ...overrides,
  })
}

export interface TestCore {
  core: Core
  gateway: FreesoundGateway
  dataDir: string
  dbPath: string
}

/**
 * Build the core in-process — no Electron. Real temp dir, real (future) db path,
 * fake gateway. This is the primary test seam (spec 0001 § Testing Decisions).
 */
export async function makeTestCore(
  opts: { gateway?: FreesoundGateway } = {},
): Promise<TestCore> {
  const dataDir = await mkdtemp(join(tmpdir(), 'freesound-desktop-test-'))
  const dbPath = join(dataDir, 'library.db')
  const gateway = opts.gateway ?? makeFakeGateway()
  const core = createCore({ gateway, dataDir, dbPath })
  return { core, gateway, dataDir, dbPath }
}
