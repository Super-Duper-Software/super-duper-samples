import { describe, expect, it, vi } from 'vitest'
import { FakeFreesoundGateway } from '../src/core/gateway/fake'
import { HttpFreesoundGateway } from '../src/core/gateway/http'
import {
  COMMERCIAL_LICENSES,
  freesoundFilterString,
  freesoundSortParam,
} from '../src/core/gateway/freesoundQuery'
import type { SearchFilter } from '../src/core/types'
import {
  countRows,
  loadFixture,
  makeFakeGateway,
  openTempDb,
  signedInCore,
} from './helpers'

describe('freesoundSortParam', () => {
  it('maps every SearchSort to a real Freesound sort value; relevance is the default (omitted)', () => {
    expect(freesoundSortParam('relevance')).toBeUndefined()
    expect(freesoundSortParam(undefined)).toBeUndefined()
    expect(freesoundSortParam('duration_asc')).toBe('duration_asc')
    expect(freesoundSortParam('duration_desc')).toBe('duration_desc')
    expect(freesoundSortParam('rating')).toBe('rating_desc')
    expect(freesoundSortParam('downloads')).toBe('downloads_desc')
    expect(freesoundSortParam('created')).toBe('created_desc')
  })
})

describe('freesoundFilterString', () => {
  it('is undefined when nothing is constrained', () => {
    expect(freesoundFilterString(undefined)).toBeUndefined()
    expect(freesoundFilterString({})).toBeUndefined()
  })

  it('translates a duration range with an uppercase TO and open ends', () => {
    expect(freesoundFilterString({ durationMin: 1, durationMax: 10 })).toBe(
      'duration:[1 TO 10]',
    )
    expect(freesoundFilterString({ durationMin: 0.5 })).toBe('duration:[0.5 TO *]')
    expect(freesoundFilterString({ durationMax: 30 })).toBe('duration:[* TO 30]')
  })

  it('translates each technical dimension to its Freesound field name', () => {
    expect(freesoundFilterString({ sampleRate: 44100 })).toBe('samplerate:44100')
    expect(freesoundFilterString({ bitDepth: 24 })).toBe('bitdepth:24')
    expect(freesoundFilterString({ channels: 2 })).toBe('channels:2')
    expect(freesoundFilterString({ fileType: 'wav' })).toBe('type:wav')
  })

  it('translates a specific license to its exact Freesound string', () => {
    expect(freesoundFilterString({ license: 'cc0' })).toBe('license:"Creative Commons 0"')
    expect(freesoundFilterString({ license: 'cc-by' })).toBe('license:"Attribution"')
    expect(freesoundFilterString({ license: 'cc-by-nc' })).toBe(
      'license:"Attribution Noncommercial"',
    )
    expect(freesoundFilterString({ license: 'sampling-plus' })).toBe('license:"Sampling+"')
  })

  it('the "usable in commercial work" control admits only CC0 + CC-BY, excluding NC and Sampling+', () => {
    const s = freesoundFilterString({ license: 'commercial' })
    expect(s).toBe('license:("Attribution" OR "Creative Commons 0")')
    expect(s).not.toMatch(/Noncommercial/)
    expect(s).not.toMatch(/Sampling/)
    expect(COMMERCIAL_LICENSES).toEqual(['Attribution', 'Creative Commons 0'])
  })

  it('composes every dimension into one space-separated Solr string', () => {
    expect(
      freesoundFilterString({
        durationMin: 1,
        durationMax: 10,
        sampleRate: 48000,
        bitDepth: 16,
        channels: 1,
        fileType: 'aiff',
        license: 'commercial',
      }),
    ).toBe(
      'duration:[1 TO 10] samplerate:48000 bitdepth:16 channels:1 type:aiff ' +
        'license:("Attribution" OR "Creative Commons 0")',
    )
  })
})

describe('HttpFreesoundGateway — sort + filter on the query string', () => {
  function gatewayWithSpy() {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => loadFixture('search-rain.json'),
    })) as unknown as typeof fetch
    const gateway = new HttpFreesoundGateway({ fetchImpl })
    return { gateway, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn> }
  }

  it('sends sort= and filter= when they constrain something', async () => {
    const { gateway, fetchImpl } = gatewayWithSpy()

    await gateway.search({
      query: 'rain',
      page: 1,
      pageSize: 15,
      sort: 'downloads',
      filter: { durationMin: 1, durationMax: 10, fileType: 'wav', license: 'commercial' },
    }, 'tok')

    const [url] = fetchImpl.mock.calls[0] as [URL]
    expect(url.searchParams.get('sort')).toBe('downloads_desc')
    expect(url.searchParams.get('filter')).toBe(
      'duration:[1 TO 10] type:wav license:("Attribution" OR "Creative Commons 0")',
    )
  })

  it('omits sort= and filter= entirely for a plain query', async () => {
    const { gateway, fetchImpl } = gatewayWithSpy()

    await gateway.search({ query: 'rain', page: 1, pageSize: 15, sort: 'relevance', filter: {} }, 'tok')

    const [url] = fetchImpl.mock.calls[0] as [URL]
    expect(url.searchParams.has('sort')).toBe(false)
    expect(url.searchParams.has('filter')).toBe(false)
  })
})

describe('core.search — each filter dimension reaches the gateway', () => {
  const cases: Array<[string, SearchFilter]> = [
    ['duration range', { durationMin: 0.5, durationMax: 3 }],
    ['sample rate', { sampleRate: 44100 }],
    ['bit depth', { bitDepth: 24 }],
    ['channel count', { channels: 2 }],
    ['file type', { fileType: 'wav' }],
    ['specific license', { license: 'cc-by-nc' }],
    ['commercial license', { license: 'commercial' }],
  ]

  for (const [name, filter] of cases) {
    it(`passes the ${name} filter through as a structured constraint`, async () => {
      const gateway = makeFakeGateway()
      const { core } = await signedInCore({ gateway })

      await core.search('thunder', { filter })

      expect(gateway.calls).toHaveLength(1)
      expect(gateway.calls[0]!.filter).toEqual(filter)
      expect(gateway.calls[0]!.sort).toBeUndefined()
    })
  }

  it('drops empty filter fields so an all-empty filter is indistinguishable from none', async () => {
    const gateway = makeFakeGateway()
    const { core } = await signedInCore({ gateway })

    await core.search('thunder', {
      filter: { fileType: '', durationMin: undefined },
      sort: 'relevance',
    })

    expect(gateway.calls[0]!.filter).toBeUndefined()
    expect(gateway.calls[0]!.sort).toBeUndefined()
  })

  it('passes each sort option through, and collapses relevance to the default', async () => {
    for (const sort of ['duration_asc', 'duration_desc', 'rating', 'downloads', 'created'] as const) {
      const gateway = makeFakeGateway()
      const { core } = await signedInCore({ gateway })
      await core.search('thunder', { sort })
      expect(gateway.calls[0]!.sort).toBe(sort)
    }

    const gateway = makeFakeGateway()
    const { core } = await signedInCore({ gateway })
    await core.search('thunder', { sort: 'relevance' })
    expect(gateway.calls[0]!.sort).toBeUndefined()
  })
})

describe('core.search — filters, sort and text query compose', () => {
  it('carries the text query, the sort and every filter field in one gateway call', async () => {
    const gateway = makeFakeGateway()
    const { core } = await signedInCore({ gateway })

    const filter = {
      durationMin: 1,
      durationMax: 30,
      sampleRate: 48000,
      bitDepth: 16,
      channels: 2,
      fileType: 'flac',
      license: 'commercial',
    } as const
    await core.search('thunder', { sort: 'rating', filter })

    expect(gateway.calls[0]).toMatchObject({
      query: 'thunder',
      page: 1,
      sort: 'rating',
      filter,
    })
  })
})

describe('core.search — filter/sort state is part of the cache key', () => {
  it('differently-filtered queries get their own rows and are served independently', async () => {
    const gateway = makeFakeGateway()
    const { core, dbPath } = await signedInCore({ gateway })

    await core.search('thunder')
    await core.search('thunder', { filter: { fileType: 'wav' } })
    await core.search('thunder', { sort: 'downloads' })
    expect(gateway.searchCallCount).toBe(3)

    await core.search('thunder')
    await core.search('thunder', { filter: { fileType: 'wav' } })
    await core.search('thunder', { sort: 'downloads' })
    expect(gateway.searchCallCount).toBe(3)

    expect(countRows(openTempDb(dbPath), 'search_cache')).toBe(3)
  })

  it('an unfiltered query hashes exactly as before — the filtered row does not shadow it', async () => {
    const gateway = makeFakeGateway()
    const { core } = await signedInCore({ gateway })

    const plain = await core.search('thunder')
    await core.search('thunder', { filter: { license: 'commercial' } })
    const plainAgain = await core.search('thunder')

    expect(gateway.searchCallCount).toBe(2)
    expect(plainAgain.sounds.map((s) => s.id)).toEqual(plain.sounds.map((s) => s.id))
  })

  it('two filter states that differ only in one field do not collide', async () => {
    const gateway = makeFakeGateway()
    const { core } = await signedInCore({ gateway })

    await core.search('thunder', { filter: { channels: 1 } })
    await core.search('thunder', { filter: { channels: 2 } })

    expect(gateway.searchCallCount).toBe(2)
  })
})

describe('core.search — next-page prefetch keeps the filter + sort', () => {
  it('prefetches page 2 with the identical sort and filter, and serves it from cache', async () => {
    const gateway = new FakeFreesoundGateway({
      pagedPages: {
        loops: [loadFixture('search-loops-p1.json'), loadFixture('search-loops-p2.json')],
      },
    })
    const { core } = await signedInCore({ gateway })

    const filter = { fileType: 'wav', durationMax: 5 }
    await core.search('loops', { page: 1, pageSize: 3, sort: 'downloads', filter })

    expect(gateway.calls).toHaveLength(2)
    for (const call of gateway.calls) {
      expect(call.sort).toBe('downloads')
      expect(call.filter).toEqual(filter)
    }
    expect(gateway.calls.map((c) => c.page)).toEqual([1, 2])

    const p2 = await core.search('loops', {
      page: 2,
      pageSize: 3,
      sort: 'downloads',
      filter,
    })
    expect(gateway.searchCallCount).toBe(2)
    expect(p2.page).toBe(2)
  })
})

describe('core search prefs — persisted in app_meta', () => {
  it('defaults to relevance + no filter before anything is saved', async () => {
    const { core } = await signedInCore()
    expect(core.getSearchPrefs()).toEqual({ sort: 'relevance', filter: {} })
  })

  it('round-trips the active sort + filter through a fresh core on the same DB', async () => {
    const { core, dbPath } = await signedInCore()

    core.setSearchPrefs({
      sort: 'duration_asc',
      filter: { license: 'commercial', bitDepth: 24, fileType: '' },
    })
    core.close()

    const { core: reopened } = await signedInCore({ dbPath })
    expect(reopened.getSearchPrefs()).toEqual({
      sort: 'duration_asc',
      filter: { license: 'commercial', bitDepth: 24 }, // empty fileType pruned
    })
  })

  it('setSearchPrefs does not run a search', async () => {
    const gateway = makeFakeGateway()
    const { core } = await signedInCore({ gateway })

    core.setSearchPrefs({ sort: 'rating', filter: { channels: 2 } })

    expect(gateway.searchCallCount).toBe(0)
  })
})
