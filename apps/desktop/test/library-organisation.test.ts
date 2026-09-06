import { basename, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  matchesLibraryFilter,
  LICENSE_FILTER_NAMES,
} from '../src/core/library/libraryFilter'
import type { LibrarySound } from '../src/core/types'
import {
  dragCore,
  fakeSound,
  LICENSES,
  makeTestCore,
  originalBytes,
  RAIN,
  seedLibrarySound,
  sleep,
  stageReady,
} from './helpers'

/** The drag tests all want RAIN staged AND saved to the Library first. */
async function dragCoreWithSavedRain(): ReturnType<typeof dragCore> {
  const tc = await dragCore()
  await stageReady(tc.core, RAIN.id)
  tc.core.saveToLibrary(RAIN.id)
  return tc
}

describe('a custom name flows through to the Drag-Out path', () => {
  it('the file handed to DragHost carries the user’s name, not the Freesound name', async () => {
    const { core, host, dataDir } = await dragCoreWithSavedRain()

    core.setCustomName(RAIN.id, 'Distant City Rain')
    const res = core.startDrag(RAIN.id)

    expect(host.last!.filePath).toBe(res.filePath)
    expect(basename(res.filePath)).toBe('Distant City Rain.wav')
    expect(res.filePath.startsWith(join(dataDir, 'drag'))).toBe(true)
    expect(readFileSync(res.filePath, 'utf8')).toBe(originalBytes(RAIN.id))
  })

  it('falls back to the Freesound name when the custom name is cleared', async () => {
    const { core } = await dragCoreWithSavedRain()

    core.setCustomName(RAIN.id, 'Temp name')
    core.setCustomName(RAIN.id, null)
    const res = core.startDrag(RAIN.id)

    expect(basename(res.filePath)).toMatch(/rain/i)
    expect(basename(res.filePath)).not.toMatch(/temp name/i)
  })

  it('sanitises unsafe characters in a custom name and keeps collisions disambiguated', async () => {
    const { core } = await dragCoreWithSavedRain()

    core.setCustomName(RAIN.id, 'Bad/Name: "quote" *?<>|')
    const res = core.startDrag(RAIN.id)
    const name = basename(res.filePath)

    expect(name.endsWith('.wav')).toBe(true)
    expect(name).not.toMatch(/[/\\:*?"<>|]/)
    expect(name.startsWith('Bad Name')).toBe(true)

    const again = core.startDrag(RAIN.id)
    expect(again.filePath).toBe(res.filePath)
  })
})

describe('renaming preserves author, License and Freesound linkage', () => {
  it('sets custom_name only — the sounds row (author / License / URL / name) is untouched', async () => {
    const { core, dataDir } = await makeTestCore()

    const sound = fakeSound(500001, {
      name: 'Original Freesound Title',
      username: 'field_recordist',
      license: LICENSES.by,
      url: 'https://freesound.org/s/500001/',
    })
    await seedLibrarySound(core, dataDir, sound)

    core.setCustomName(500001, 'My Take On It')
    core.setLibraryTags(500001, ['scene-7', 'keeper'])

    const [entry] = core.listLibrary() as LibrarySound[]
    expect(entry.id).toBe(500001)
    expect(entry.customName).toBe('My Take On It')
    expect(entry.effectiveName).toBe('My Take On It')
    expect(entry.name).toBe('Original Freesound Title')
    expect(entry.username).toBe('field_recordist')
    expect(entry.license).toEqual(LICENSES.by)
    expect(entry.url).toBe('https://freesound.org/s/500001/')
    expect(entry.tags).toEqual(['test'])
    expect(entry.customTags).toEqual(['scene-7', 'keeper'])
  })

  it('setCustomName / setLibraryTags throw for a Sound that is not in the Library', async () => {
    const { core } = await makeTestCore()
    expect(() => core.setCustomName(999, 'x')).toThrow(/not in the Library/i)
    expect(() => core.setLibraryTags(999, ['x'])).toThrow(/not in the Library/i)
  })

  it('custom name + tags survive an app restart (they are on disk, not in memory)', async () => {
    const first = await makeTestCore()
    const sound = fakeSound(500002, { name: 'freesound name' })
    await seedLibrarySound(first.core, first.dataDir, sound)
    first.core.setCustomName(500002, 'Persisted Name')
    first.core.setLibraryTags(500002, ['alpha', 'beta'])
    first.core.close()

    const reopened = await makeTestCore({ dbPath: first.dbPath })
    const [entry] = reopened.core.listLibrary() as LibrarySound[]
    expect(entry.customName).toBe('Persisted Name')
    expect(entry.customTags).toEqual(['alpha', 'beta'])
    expect(entry.name).toBe('freesound name')
  })
})

describe('core.filterLibrary — every dimension, no gateway call', () => {
  async function seededLibrary() {
    const { core, gateway, dataDir, dbPath } = await makeTestCore()

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
    await seedLibrarySound(core, dataDir, a)
    await sleep(3)
    await seedLibrarySound(core, dataDir, b)
    await sleep(3)
    await seedLibrarySound(core, dataDir, c)

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

    const reopened = await makeTestCore({ dbPath })
    expect(reopened.core.getLibraryFilter()).toEqual(saved)
  })

  it('setLibraryFilter does not run a search', async () => {
    const { core, gateway } = await makeTestCore()
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
