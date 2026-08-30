import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, runMigrations } from '../src/core/db/index'
import { createCore } from '../src/core'
import { makeFakeGateway } from './helpers/makeTestCore'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function tempDbPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'freesound-migrations-'))
  dirs.push(dir)
  return join(dir, 'library.db')
}

function tableNames(db: ReturnType<typeof openDb>): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name)
}

describe('database migrations', () => {
  it('opening a fresh database creates the whole schema', async () => {
    const db = openDb(await tempDbPath())

    const tables = tableNames(db)
    for (const t of [
      'sounds',
      'search_cache',
      'library_entries',
      'collections',
      'collection_members',
      'staged_entries',
      'peaks',
      'auth',
      'app_meta',
      'schema_migrations',
    ]) {
      expect(tables).toContain(t)
    }

    // user_version tracks the highest applied migration id.
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    db.close()
  })

  it('migration 002 adds the staging content-store columns and app_meta', async () => {
    const db = openDb(await tempDbPath())

    const cols = (
      db.prepare("PRAGMA table_info('staged_entries')").all() as { name: string }[]
    ).map((r) => r.name)
    for (const c of ['sound_id', 'byte_size', 'last_access_at', 'path', 'created_at']) {
      expect(cols).toContain(c)
    }

    // app_meta is a plain key/value table.
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('k', 'v')").run()
    expect(
      (db.prepare("SELECT value FROM app_meta WHERE key = 'k'").get() as { value: string })
        .value,
    ).toBe('v')

    db.close()
  })

  it('opening an already-current database applies nothing', async () => {
    const dbPath = await tempDbPath()

    const first = openDb(dbPath)
    first.close()

    const second = openDb(dbPath)
    const result = runMigrations(second)
    expect(result.applied).toEqual([])
    expect(second.pragma('user_version', { simple: true })).toBe(2)
    second.close()
  })

  it('sounds rows persist across two createCore instances on the same dbPath', async () => {
    const dbPath = await tempDbPath()
    const dataDir = join(dbPath, '..')

    const coreA = createCore({ gateway: makeFakeGateway(), dataDir, dbPath })
    await coreA.search('rain')
    coreA.close()

    // A brand-new core, same file, fresh gateway that would THROW if hit.
    const gatewayB = makeFakeGateway({ failWith: new Error('must not call gateway') })
    const coreB = createCore({ gateway: gatewayB, dataDir, dbPath })
    const again = await coreB.search('rain')

    expect(again.sounds.length).toBeGreaterThan(0)
    expect(again.totalCount).toBe(1873)
    coreB.close()
  })
})
