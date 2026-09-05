import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRecordingDragHost, type RecordingDragHost } from '../src/core'
import { writeOriginal } from '../src/core/staging/contentStore'
import {
  matchesLibraryFilter,
  LICENSE_FILTER_NAMES,
} from '../src/core/library/libraryFilter'
import type { LibrarySound, Sound } from '../src/core/types'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

const RAIN_ID = 321967

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

/** Seed a `sounds` row + Original on disk and save it to the Library, no network. */
async function seedSaved(
  core: Awaited<ReturnType<typeof makeTestCore>>['core'],
  dataDir: string,
  sound: Sound,
): Promise<void> {
  await writeOriginal(
    dataDir,
    sound,
    new TextEncoder().encode(`ORIG-${sound.id}`),
    Date.now(),
  )
  core.saveToLibrary(sound.id, sound)
}

/** A signed-in, consenting core wired to a recording DragHost (for the drag tests). */
async function dragCore() {
  const host = createRecordingDragHost({ multiFileDragSupported: false })
  const gateway = makeFakeGateway()
  const tc = await makeTestCore({ gateway, dragHost: host })
  cleanups.push(() => tc.core.close())
  await tc.core.signIn()
  tc.core.grantStagingConsent()
  await tc.core.search('rain')
  tc.core.stageOnAudition(RAIN_ID)
  await waitUntil(
    () => tc.core.getStagingStatus([RAIN_ID])[RAIN_ID] === 'ready',
  )
  tc.core.saveToLibrary(RAIN_ID)
  return { ...tc, host: host as RecordingDragHost, gateway }
}

describe('a custom name flows through to the Drag-Out path', () => {
  it('the file handed to DragHost carries the user’s name, not the Freesound name', async () => {
    const { core, host, dataDir } = await dragCore()

    core.setCustomName(RAIN_ID, 'Distant City Rain')
    const res = core.startDrag(RAIN_ID)

    expect(host.last!.filePath).toBe(res.filePath)
    expect(basename(res.filePath)).toBe('Distant City Rain.wav')
    expect(res.filePath.startsWith(join(dataDir, 'drag'))).toBe(true)
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(res.filePath, 'utf8')).toBe(`FAKE-ORIGINAL:${RAIN_ID}`)
  })

  it('falls back to the Freesound name when the custom name is cleared', async () => {
    const { core } = await dragCore()

    core.setCustomName(RAIN_ID, 'Temp name')
    core.setCustomName(RAIN_ID, null)
    const res = core.startDrag(RAIN_ID)

    expect(basename(res.filePath)).toMatch(/rain/i)
    expect(basename(res.filePath)).not.toMatch(/temp name/i)
  })

  it('sanitises unsafe characters in a custom name and keeps collisions disambiguated', async () => {
    const { core } = await dragCore()

    core.setCustomName(RAIN_ID, 'Bad/Name: "quote" *?<>|')
    const res = core.startDrag(RAIN_ID)
    const name = basename(res.filePath)

    expect(name.endsWith('.wav')).toBe(true)
    expect(name).not.toMatch(/[/\\:*?"<>|]/)
    expect(name.startsWith('Bad Name')).toBe(true)

    const again = core.startDrag(RAIN_ID)
    expect(again.filePath).toBe(res.filePath)
  })
})

describe('renaming preserves author, License and Freesound linkage', () => {
  it('sets custom_name only — the sounds row (author / License / URL / name) is untouched', async () => {
    const { core, dataDir } = await makeTestCore({
      gateway: makeFakeGateway(),
    })
    cleanups.push(() => core.close())

    const sound = fakeSound(500001, {
      name: 'Original Freesound Title',
      username: 'field_recordist',
      license: {
        url: 'http://creativecommons.org/licenses/by/4.0/',
        name: 'CC-BY',
      },
      url: 'https://freesound.org/s/500001/',
    })
    await seedSaved(core, dataDir, sound)

    core.setCustomName(500001, 'My Take On It')
    core.setLibraryTags(500001, ['scene-7', 'keeper'])

    const [entry] = core.listLibrary() as LibrarySound[]
    expect(entry.id).toBe(500001)
    expect(entry.customName).toBe('My Take On It')
    expect(entry.effectiveName).toBe('My Take On It')
    expect(entry.name).toBe('Original Freesound Title')
    expect(entry.username).toBe('field_recordist')
    expect(entry.license).toEqual({
      url: 'http://creativecommons.org/licenses/by/4.0/',
      name: 'CC-BY',
    })
    expect(entry.url).toBe('https://freesound.org/s/500001/')
    expect(entry.tags).toEqual(['test'])
    expect(entry.customTags).toEqual(['scene-7', 'keeper'])
  })

  it('setCustomName / setLibraryTags throw for a Sound that is not in the Library', async () => {
    const { core } = await makeTestCore({ gateway: makeFakeGateway() })
    cleanups.push(() => core.close())
    expect(() => core.setCustomName(999, 'x')).toThrow(/not in the Library/i)
    expect(() => core.setLibraryTags(999, ['x'])).toThrow(/not in the Library/i)
  })

  it('custom name + tags survive an app restart (they are on disk, not in memory)', async () => {
    const first = await makeTestCore({ gateway: makeFakeGateway() })
    cleanups.push(() => {
      try {
        first.core.close()
      } catch {
        /* maybe closed */
      }
    })
    const sound = fakeSound(500002, { name: 'freesound name' })
    await seedSaved(first.core, first.dataDir, sound)
    first.core.setCustomName(500002, 'Persisted Name')
    first.core.setLibraryTags(500002, ['alpha', 'beta'])
    first.core.close()

    const reopened = await makeTestCore({
      gateway: makeFakeGateway(),
      dbPath: first.dbPath,
    })
    cleanups.push(() => reopened.core.close())
    const [entry] = reopened.core.listLibrary() as LibrarySound[]
    expect(entry.customName).toBe('Persisted Name')
    expect(entry.customTags).toEqual(['alpha', 'beta'])
    expect(entry.name).toBe('freesound name')
  })
})

describe('core.filterLibrary — every dimension, no gateway call', () => {
  async function seededLibrary() {
    const gateway = makeFakeGateway()
    const { core, dataDir, dbPath } = await makeTestCore({ gateway })
    cleanups.push(() => core.close())

    const a = fakeSound(600001, {
      name: 'Rainstorm field recording',
      username: 'alice',
      type: 'wav',
      duration: 2,
      tags: ['rain', 'loop'],
      license: { url: 'x', name: 'CC0' },
    })
    const b = fakeSound(600002, {
      name: 'Thunder crack',
      username: 'bob',
      type: 'aiff',
      duration: 30,
      tags: ['thunder', 'storm'],
      license: { url: 'x', name: 'CC-BY' },
    })
    const c = fakeSound(600003, {
      name: 'Long ambient bed',
      username: 'carol',
      type: 'flac',
      duration: 120,
      tags: ['ambient'],
      license: { url: 'x', name: 'CC-BY-NC' },
    })
    await seedSaved(core, dataDir, a)
    await sleep(3)
    await seedSaved(core, dataDir, b)
    await sleep(3)
    await seedSaved(core, dataDir, c)

    core.setLibraryTags(600002, ['favourite'])
    core.setCustomName(600003, 'Carol Special Bed')

    return { core, gateway, dbPath }
  }

  const ids = (list: LibrarySound[]): number[] =>
    list.map((s) => s.id).sort((x, y) => x - y)

  it('filters by file format, License, duration, tag (inherited + custom), free text — and their combinations', async () => {
    const { core, gateway } = await seededLibrary()

    expect(ids(core.filterLibrary({ fileType: 'wav' }))).toEqual([600001])
    expect(ids(core.filterLibrary({ fileType: 'AIFF' }))).toEqual([600002])

    expect(ids(core.filterLibrary({ license: 'commercial' }))).toEqual([
      600001, 600002,
    ])
    expect(ids(core.filterLibrary({ license: 'cc-by-nc' }))).toEqual([600003])

    expect(
      ids(core.filterLibrary({ durationMin: 10, durationMax: 60 })),
    ).toEqual([600002])
    expect(ids(core.filterLibrary({ durationMax: 5 }))).toEqual([600001])

    expect(ids(core.filterLibrary({ tags: ['ambient'] }))).toEqual([600003])
    expect(ids(core.filterLibrary({ tags: ['favourite'] }))).toEqual([600002])
    expect(ids(core.filterLibrary({ tags: ['loop', 'thunder'] }))).toEqual([
      600001, 600002,
    ])

    expect(ids(core.filterLibrary({ text: 'carol special' }))).toEqual([600003])
    expect(ids(core.filterLibrary({ text: 'rainstorm' }))).toEqual([600001])
    expect(ids(core.filterLibrary({ text: 'bob' }))).toEqual([600002])
    expect(ids(core.filterLibrary({ text: 'thunder' }))).toEqual([600002])

    expect(
      ids(core.filterLibrary({ fileType: 'aiff', license: 'commercial' })),
    ).toEqual([600002])
    expect(
      ids(
        core.filterLibrary({ tags: ['rain'], durationMax: 5, fileType: 'wav' }),
      ),
    ).toEqual([600001])
    expect(
      ids(core.filterLibrary({ license: 'commercial', durationMin: 100 })),
    ).toEqual([])

    expect(core.filterLibrary({}).map((s) => s.id)).toEqual([
      600003, 600002, 600001,
    ])

    expect(gateway.searchCallCount).toBe(0)
    expect(gateway.calls).toHaveLength(0)
  })

  it('the persisted Library filter round-trips through a fresh core on the same DB', async () => {
    const { core, dbPath } = await seededLibrary()

    const saved = core.setLibraryFilter({
      tags: ['Rain', 'rain', ' loop '],
      text: '  storm ',
      fileType: 'wav',
      durationMin: 1,
      license: 'commercial',
    })
    expect(saved.tags).toEqual(['Rain', 'loop'])
    expect(saved.text).toBe('storm')
    core.close()

    const reopened = await makeTestCore({ gateway: makeFakeGateway(), dbPath })
    cleanups.push(() => reopened.core.close())
    expect(reopened.core.getLibraryFilter()).toEqual(saved)
  })

  it('setLibraryFilter does not run a search', async () => {
    const gateway = makeFakeGateway()
    const { core } = await makeTestCore({ gateway })
    cleanups.push(() => core.close())
    core.setLibraryFilter({ text: 'anything', fileType: 'wav' })
    expect(gateway.searchCallCount).toBe(0)
  })
})

describe('matchesLibraryFilter (pure)', () => {
  const base: LibrarySound = {
    ...fakeSound(1, {
      name: 'Freesound Name',
      username: 'author_x',
      type: 'wav',
      duration: 10,
      tags: ['inherited-tag'],
      license: { url: 'x', name: 'CC-BY' },
    }),
    customName: 'My Name',
    effectiveName: 'My Name',
    customTags: ['own-tag'],
    savedAt: 1,
    derivedFrom: null,
    editSpec: null,
  }

  it('composes dimensions with AND and matches tags across inherited + custom', () => {
    expect(matchesLibraryFilter(base, {})).toBe(true)
    expect(matchesLibraryFilter(base, { tags: ['own-tag'] })).toBe(true)
    expect(matchesLibraryFilter(base, { tags: ['inherited-tag'] })).toBe(true)
    expect(matchesLibraryFilter(base, { tags: ['nope'] })).toBe(false)
    expect(matchesLibraryFilter(base, { fileType: 'aiff' })).toBe(false)
    expect(
      matchesLibraryFilter(base, { durationMin: 5, durationMax: 15 }),
    ).toBe(true)
    expect(matchesLibraryFilter(base, { durationMin: 11 })).toBe(false)
    expect(matchesLibraryFilter(base, { text: 'my name' })).toBe(true)
    expect(matchesLibraryFilter(base, { text: 'freesound' })).toBe(true)
    expect(matchesLibraryFilter(base, { text: 'author_x' })).toBe(true)
    expect(matchesLibraryFilter(base, { text: 'own-tag' })).toBe(true)
    expect(matchesLibraryFilter(base, { license: 'commercial' })).toBe(true)
    expect(
      matchesLibraryFilter(base, { license: 'commercial', fileType: 'aiff' }),
    ).toBe(false)
  })

  it('LICENSE_FILTER_NAMES keeps "commercial" to CC0 + CC-BY', () => {
    expect(LICENSE_FILTER_NAMES.commercial).toEqual(['CC0', 'CC-BY'])
  })
})
