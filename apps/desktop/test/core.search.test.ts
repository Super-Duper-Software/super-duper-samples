import { describe, expect, it } from 'vitest'
import { GatewayError, NetworkError, type Sound } from '../src/core'
import { FakeFreesoundGateway } from '../src/core/gateway/fake'
import { loadFixture, makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

function assertFullRowShape(s: Sound): void {
  expect(typeof s.id).toBe('number')
  expect(typeof s.name).toBe('string')
  expect(typeof s.username).toBe('string')
  expect(typeof s.license.url).toBe('string')
  expect(typeof s.license.name).toBe('string')
  expect(typeof s.duration).toBe('number')
  expect(Array.isArray(s.tags)).toBe(true)
  expect(typeof s.filesize).toBe('number')
  expect(typeof s.type).toBe('string')
  expect(typeof s.samplerate).toBe('number')
  expect(typeof s.channels).toBe('number')
  expect(typeof s.bitdepth).toBe('number')
  expect(typeof s.previewUrls.hqMp3).toBe('string')
  expect(typeof s.previewUrls.lqMp3).toBe('string')
  expect(typeof s.previewUrls.hqOgg).toBe('string')
  expect(typeof s.previewUrls.lqOgg).toBe('string')
  expect(typeof s.waveformUrls.m).toBe('string')
  expect(typeof s.waveformUrls.l).toBe('string')
  expect(typeof s.url).toBe('string')
  expect(typeof s.downloadCount).toBe('number')
  expect(typeof s.avgRating).toBe('number')
  expect(typeof s.created).toBe('string')
}

describe('core.search', () => {
  it('returns Sounds for a query, every row field populated', async () => {
    const { core } = await makeTestCore()

    const result = await core.search('rain')

    expect(result.query).toBe('rain')
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(15)
    expect(result.totalCount).toBeGreaterThan(0)
    expect(result.sounds.length).toBeGreaterThan(0)
    for (const s of result.sounds) assertFullRowShape(s)

    // License short names are derived from the deed URL.
    expect(result.sounds.map((s) => s.license.name)).toContain('CC-BY')
    expect(result.sounds.map((s) => s.license.name)).toContain('CC0')
  })

  it('distinguishes an empty result set from a failure', async () => {
    const { core } = await makeTestCore()

    const result = await core.search('zzzznotarealquery')

    expect(result.totalCount).toBe(0)
    expect(result.sounds).toEqual([])
  })

  it('surfaces a network failure as a thrown typed error, not an empty list', async () => {
    const gateway = makeFakeGateway({
      failWith: new NetworkError('offline'),
    })
    const { core } = await makeTestCore({ gateway })

    await expect(core.search('rain')).rejects.toBeInstanceOf(NetworkError)
  })

  it('surfaces a gateway error (e.g. 429/500) as a thrown typed error', async () => {
    const gateway = makeFakeGateway({
      failWith: new GatewayError('rate limited', 429),
    })
    const { core } = await makeTestCore({ gateway })

    await expect(core.search('rain')).rejects.toBeInstanceOf(GatewayError)
  })

  it('one search call yields a full page with no follow-up gateway calls', async () => {
    const gateway = new FakeFreesoundGateway({
      pages: { rain: loadFixture('search-rain.json') },
    })
    const { core } = await makeTestCore({ gateway })

    const result = await core.search('rain')

    expect(gateway.searchCallCount).toBe(1)
    // Every field needed to render a row is already present — nothing to fetch per Sound.
    for (const s of result.sounds) assertFullRowShape(s)
    expect(gateway.searchCallCount).toBe(1)
  })

  it('does not call the gateway for a blank query', async () => {
    const gateway = makeFakeGateway()
    const { core } = await makeTestCore({ gateway })

    const result = await core.search('   ')

    expect(result.sounds).toEqual([])
    expect(result.totalCount).toBe(0)
    expect((gateway as FakeFreesoundGateway).searchCallCount).toBe(0)
  })

  it('passes page and pageSize through to the gateway', async () => {
    const gateway = makeFakeGateway()
    const { core } = await makeTestCore({ gateway })

    await core.search('rain', { page: 3, pageSize: 42 })

    expect((gateway as FakeFreesoundGateway).calls[0]).toEqual({
      query: 'rain',
      page: 3,
      pageSize: 42,
    })
  })
})
