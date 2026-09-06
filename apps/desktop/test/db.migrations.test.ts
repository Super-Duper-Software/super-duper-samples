import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runMigrations, type DB } from '../src/core/db/index'
import { MIGRATIONS } from '../src/core/db/migrations'
import { createCore } from '../src/core'
import {
  FakeAuthPlatform,
  FakeScheduler,
  makeFakeGateway,
  makeTempDir,
  openTempDb,
} from './helpers'

async function tempDbPath(): Promise<string> {
  return join(await makeTempDir('freesound-migrations-'), 'library.db')
}

function tableNames(db: DB): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name)
}

describe('database migrations', () => {
  it('opening a fresh database creates the whole schema', async () => {
    const db = openTempDb(await tempDbPath())

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
      'download_log',
      'schema_migrations',
    ]) {
      expect(tables).toContain(t)
    }

    expect(db.pragma('user_version', { simple: true })).toBe(5)
  })

  it('migration 002 adds the staging content-store columns and app_meta', async () => {
    const db = openTempDb(await tempDbPath())

    const cols = (
      db.prepare("PRAGMA table_info('staged_entries')").all() as { name: string }[]
    ).map((r) => r.name)
    for (const c of ['sound_id', 'byte_size', 'last_access_at', 'path', 'created_at']) {
      expect(cols).toContain(c)
    }

    db.prepare("INSERT INTO app_meta (key, value) VALUES ('k', 'v')").run()
    expect(
      (db.prepare("SELECT value FROM app_meta WHERE key = 'k'").get() as { value: string })
        .value,
    ).toBe('v')

  })

  it('migration 003 adds the append-only download_log', async () => {
    const db = openTempDb(await tempDbPath())

    const cols = (
      db.prepare("PRAGMA table_info('download_log')").all() as { name: string }[]
    ).map((r) => r.name)
    for (const c of ['id', 'sound_id', 'downloaded_at']) {
      expect(cols).toContain(c)
    }

    db.prepare(
      'INSERT INTO download_log (sound_id, downloaded_at) VALUES (1, 1000)',
    ).run()
    expect(
      (
        db
          .prepare(
            'SELECT COUNT(*) AS n FROM download_log WHERE downloaded_at >= 500',
          )
          .get() as { n: number }
      ).n,
    ).toBe(1)

  })

  it('migration 004 adds the three nullable Edit columns to sounds', async () => {
    const db = openTempDb(await tempDbPath())

    const cols = (
      db.prepare("PRAGMA table_info('sounds')").all() as { name: string }[]
    ).map((r) => r.name)
    for (const c of ['derived_from', 'edit_spec', 'local_path']) {
      expect(cols).toContain(c)
    }

  })

  it('migration 005 deletes undecodable peak sentinels and leaves real peak rows', async () => {
    const db = openTempDb(await tempDbPath())
    db.pragma('foreign_keys = OFF')

    const insert = db.prepare(
      'INSERT INTO peaks (sound_id, sample_rate, bucket_count, data, computed_at) VALUES (?, ?, ?, ?, ?)',
    )
    insert.run(1, 44100, 2000, Buffer.alloc(8000), 0)
    insert.run(2, 0, 0, Buffer.alloc(0), 0)

    db.exec(MIGRATIONS.find((m) => m.id === 5)!.up)

    const ids = (
      db.prepare('SELECT sound_id FROM peaks ORDER BY sound_id').all() as {
        sound_id: number
      }[]
    ).map((r) => r.sound_id)
    expect(ids).toEqual([1])

  })

  it('opening an already-current database applies nothing', async () => {
    const dbPath = await tempDbPath()

    const created = openTempDb(dbPath)
    expect(created.pragma('user_version', { simple: true })).toBe(5)

    const second = openTempDb(dbPath)
    const result = runMigrations(second)
    expect(result.applied).toEqual([])
    expect(second.pragma('user_version', { simple: true })).toBe(5)
  })

  it('sounds rows persist across two createCore instances on the same dbPath', async () => {
    const dbPath = await tempDbPath()
    const dataDir = join(dbPath, '..')

    const coreA = createCore({
      gateway: makeFakeGateway(),
      dataDir,
      dbPath,
      authPlatform: new FakeAuthPlatform(),
      scheduler: new FakeScheduler(),
      clientId: 'test-client-id',
    })
    await coreA.signIn()
    await coreA.search('rain')
    coreA.close()

    const gatewayB = makeFakeGateway({ failWith: new Error('must not call gateway') })
    const coreB = createCore({
      gateway: gatewayB,
      dataDir,
      dbPath,
      authPlatform: new FakeAuthPlatform(),
      scheduler: new FakeScheduler(),
      clientId: 'test-client-id',
    })
    await coreB.signIn()
    const again = await coreB.search('rain')

    expect(again.sounds.length).toBeGreaterThan(0)
    expect(again.totalCount).toBe(1873)
    coreB.close()
  })
})
