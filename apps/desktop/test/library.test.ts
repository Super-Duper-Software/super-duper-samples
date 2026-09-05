import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/core/db/index'
import { writeOriginal } from '../src/core/staging/contentStore'
import type { FreesoundGateway } from '../src/core/gateway/index'
import type { Sound } from '../src/core/types'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

const RAIN_ID = 321967
const DRIZZLE_ID = 408535
const THUNDER_ID = 17185

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const c of cleanups.splice(0)) {
    try {
      c()
    } catch {
      /* ignore */
    }
  }
})

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

async function waitUntil(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitUntil timed out')
    await sleep(5)
  }
}

/** A signed-in, consenting core (fake gateway with the committed fixtures). */
async function signedInCore(opts: Parameters<typeof makeTestCore>[0] = {}) {
  const gateway = opts.gateway ?? makeFakeGateway()
  const tc = await makeTestCore({ ...opts, gateway })
  cleanups.push(() => tc.core.close())
  await tc.core.signIn()
  tc.core.grantStagingConsent()
  return tc
}

function openTemp(dbPath: string): DB {
  const db = openDb(dbPath)
  cleanups.push(() => {
    try {
      db.close()
    } catch {
      /* already closed */
    }
  })
  return db
}

async function stageReady(
  core: Awaited<ReturnType<typeof signedInCore>>['core'],
  id: number,
): Promise<void> {
  core.stageOnAudition(id)
  await waitUntil(() => core.getStagingStatus([id])[id] === 'ready')
}

function fakeSound(id: number, over: Partial<Sound> = {}): Sound {
  return {
    id,
    name: `sound ${id}`,
    username: 'tester',
    license: {
      url: 'http://creativecommons.org/publicdomain/zero/1.0/',
      name: 'CC0',
    },
    duration: 3,
    tags: ['test'],
    filesize: 1,
    type: 'wav',
    samplerate: 44100,
    channels: 2,
    bitdepth: 16,
    previewUrls: { hqMp3: 'hq.mp3', lqMp3: 'lq.mp3', hqOgg: '', lqOgg: '' },
    waveformUrls: { m: 'm.png', l: 'l.png' },
    url: `https://freesound.org/s/${id}/`,
    downloadCount: 0,
    avgRating: 0,
    created: '2020-01-01T00:00:00Z',
    ...over,
  }
}

/** Every method rejects — stands in for "no internet connection". */
function deadGateway(): FreesoundGateway {
  const fail = (): Promise<never> =>
    Promise.reject(new Error('gateway unavailable (offline)'))
  return {
    search: fail,
    getPreviewStream: fail,
    downloadOriginal: fail,
    exchangeToken: fail,
    refreshToken: fail,
    getMe: fail,
  } as unknown as FreesoundGateway
}

describe('core.saveToLibrary — promotes a Staged Sound, no file move', () => {
  it('writes a library row and drops the staged row, leaving the exact same file on disk', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    await core.search('rain')
    await stageReady(core, RAIN_ID)

    const original = join(dataDir, 'content', `${RAIN_ID}.wav`)
    const before = statSync(original)

    core.saveToLibrary(RAIN_ID)

    const after = statSync(original)
    expect(after.ino).toBe(before.ino)
    expect(existsSync(original)).toBe(true)
    expect(readFileSync(original, 'utf8')).toBe(`FAKE-ORIGINAL:${RAIN_ID}`)

    const db = openTemp(dbPath)
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS n FROM staged_entries WHERE sound_id = ?')
          .get(RAIN_ID) as { n: number }
      ).n,
    ).toBe(0)
    const row = db
      .prepare('SELECT * FROM library_entries WHERE sound_id = ?')
      .get(RAIN_ID) as { saved_at: number } | undefined
    expect(row?.saved_at).toBeGreaterThan(0)

    expect(core.listLibrary().map((s) => s.id)).toEqual([RAIN_ID])
  })

  it('is idempotent — a second save is a no-op, no duplicate, saved_at unchanged', async () => {
    const { core, dbPath } = await signedInCore()
    await core.search('rain')
    await stageReady(core, RAIN_ID)

    core.saveToLibrary(RAIN_ID)
    const db = openTemp(dbPath)
    const first = (
      db
        .prepare('SELECT saved_at FROM library_entries WHERE sound_id = ?')
        .get(RAIN_ID) as { saved_at: number }
    ).saved_at

    await sleep(6)
    expect(() => core.saveToLibrary(RAIN_ID)).not.toThrow()
    core.saveToLibrary(RAIN_ID)

    const rows = db
      .prepare('SELECT saved_at FROM library_entries WHERE sound_id = ?')
      .all(RAIN_ID) as { saved_at: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.saved_at).toBe(first)
  })

  it('throws rather than saving a Sound it has no metadata for', async () => {
    const { core } = await signedInCore()
    expect(() => core.saveToLibrary(99999999)).toThrow(/no metadata/i)
  })
})

describe('core.listLibrary', () => {
  it('orders by date saved — newest first by default, oldest first with dir:asc', async () => {
    const { core } = await signedInCore()
    await core.search('rain')
    await stageReady(core, RAIN_ID)
    await stageReady(core, DRIZZLE_ID)
    await stageReady(core, THUNDER_ID)

    core.saveToLibrary(RAIN_ID)
    await sleep(4)
    core.saveToLibrary(DRIZZLE_ID)
    await sleep(4)
    core.saveToLibrary(THUNDER_ID)

    expect(core.listLibrary().map((s) => s.id)).toEqual([
      THUNDER_ID,
      DRIZZLE_ID,
      RAIN_ID,
    ])
    expect(core.listLibrary({ dir: 'asc' }).map((s) => s.id)).toEqual([
      RAIN_ID,
      DRIZZLE_ID,
      THUNDER_ID,
    ])
  })
})

describe('core.getLibraryMembership', () => {
  it('reports a saved Sound as in-Library and the rest as not', async () => {
    const { core } = await signedInCore()
    const page = await core.search('rain')
    const ids = page.sounds.map((s) => s.id)
    await stageReady(core, RAIN_ID)
    core.saveToLibrary(RAIN_ID)

    const membership = core.getLibraryMembership(ids)
    expect(membership[RAIN_ID]).toBe(true)
    for (const id of ids.filter((i) => i !== RAIN_ID)) {
      expect(membership[id]).toBe(false)
    }
    expect(Object.keys(membership).map(Number).sort()).toEqual(
      [...ids].sort((a, b) => a - b),
    )
  })
})

describe('core.deleteFromLibrary', () => {
  it('removes the row AND the Original + sidecar, keeping the sounds metadata row', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    await core.search('rain')
    await stageReady(core, RAIN_ID)
    core.saveToLibrary(RAIN_ID)

    const original = join(dataDir, 'content', `${RAIN_ID}.wav`)
    const sidecar = join(dataDir, 'content', `${RAIN_ID}.json`)
    expect(existsSync(original)).toBe(true)

    await core.deleteFromLibrary(RAIN_ID)

    expect(existsSync(original)).toBe(false)
    expect(existsSync(sidecar)).toBe(false)
    expect(core.listLibrary()).toEqual([])

    const db = openTemp(dbPath)
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS n FROM library_entries WHERE sound_id = ?')
          .get(RAIN_ID) as { n: number }
      ).n,
    ).toBe(0)
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS n FROM sounds WHERE id = ?')
          .get(RAIN_ID) as { n: number }
      ).n,
    ).toBe(1)
    expect(core.getLibraryMembership([RAIN_ID])[RAIN_ID]).toBe(false)
  })
})

describe('the Library works with the gateway unavailable', () => {
  it('lists, serves paths for and deletes a saved Sound without any gateway call', async () => {
    const { core, dataDir } = await makeTestCore({ gateway: deadGateway() })
    cleanups.push(() => core.close())

    const sound = fakeSound(700001, { name: 'offline keeper', type: 'wav' })
    await writeOriginal(dataDir, sound, new TextEncoder().encode('BYTES'), Date.now())
    core.saveToLibrary(sound.id, sound)

    const listed = core.listLibrary()
    expect(listed.map((s) => s.id)).toEqual([sound.id])
    expect(listed[0]!.name).toBe('offline keeper')

    expect(core.getLibraryMembership([sound.id])[sound.id]).toBe(true)
    expect(core.getContentPath(sound.id)).toBe(
      join(dataDir, 'content', `${sound.id}.wav`),
    )
    expect(core.getFreesoundUrl(sound.id)).toBe(sound.url)

    await core.deleteFromLibrary(sound.id)
    expect(core.listLibrary()).toEqual([])
    expect(existsSync(join(dataDir, 'content', `${sound.id}.wav`))).toBe(false)
  })

  it('survives a reopen — the Library is on disk, not in memory', async () => {
    const dir = await makeTestCore({ gateway: deadGateway() })
    cleanups.push(() => {
      try {
        dir.core.close()
      } catch {
        /* may already be closed */
      }
    })
    const sound = fakeSound(700002, { type: 'wav' })
    await writeOriginal(
      dir.dataDir,
      sound,
      new TextEncoder().encode('BYTES'),
      Date.now(),
    )
    dir.core.saveToLibrary(sound.id, sound)
    dir.core.close()

    const reopened = await makeTestCore({
      gateway: deadGateway(),
      dbPath: dir.dbPath,
    })
    cleanups.push(() => reopened.core.close())
    expect(reopened.core.listLibrary().map((s) => s.id)).toEqual([sound.id])
  })
})
