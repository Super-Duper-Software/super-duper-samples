import { describe, expect, it, vi } from 'vitest'
import { NotImplemented } from '../src/core'
import { FakeFreesoundGateway } from '../src/core/gateway/fake'
import { HttpFreesoundGateway } from '../src/core/gateway/http'
import { SEARCH_FIELDS } from '../src/core/gateway/index'
import { GatewayError, NetworkError } from '../src/core/errors'
import { loadFixture } from './helpers/makeTestCore'

describe('FakeFreesoundGateway', () => {
  it('returns the fixture page for a known query and records the call', async () => {
    const gateway = new FakeFreesoundGateway({
      pages: { rain: loadFixture('search-rain.json') },
    })

    const page = await gateway.search({ query: 'rain', page: 1, pageSize: 15 })

    expect(page.count).toBeGreaterThan(0)
    expect(page.results.length).toBe(3)
    expect(gateway.searchCallCount).toBe(1)
    expect(gateway.calls[0]).toEqual({ query: 'rain', page: 1, pageSize: 15 })
  })

  it('later-ticket methods throw NotImplemented', async () => {
    const gateway = new FakeFreesoundGateway()
    await expect(gateway.getPreviewStream()).rejects.toBeInstanceOf(NotImplemented)
    await expect(gateway.downloadOriginal()).rejects.toBeInstanceOf(NotImplemented)
    await expect(gateway.exchangeToken()).rejects.toBeInstanceOf(NotImplemented)
    await expect(gateway.refreshToken()).rejects.toBeInstanceOf(NotImplemented)
  })
})

describe('HttpFreesoundGateway', () => {
  function fakeResponse(body: unknown, init: Partial<Response> = {}): Response {
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
      ...init,
    } as Response
  }

  it('requests search/text with token auth and exactly the row field set', async () => {
    const fetchImpl = vi.fn(
      (_url: URL, _init?: RequestInit) =>
        Promise.resolve(fakeResponse(loadFixture('search-rain.json'))),
    )
    const gateway = new HttpFreesoundGateway({
      apiKey: 'test-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await gateway.search({ query: 'rain', page: 2, pageSize: 15 })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchImpl.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toContain('https://freesound.org/apiv2/search/text/')
    expect(url.searchParams.get('query')).toBe('rain')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('15')
    expect(url.searchParams.get('fields')).toBe(SEARCH_FIELDS)
    expect((opts.headers as Record<string, string>).Authorization).toBe('Token test-key')
  })

  it('throws GatewayError on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({}, { ok: false, status: 429 }),
    ) as unknown as typeof fetch
    const gateway = new HttpFreesoundGateway({ apiKey: 'k', fetchImpl })

    await expect(gateway.search({ query: 'x', page: 1, pageSize: 15 })).rejects.toMatchObject(
      { name: 'GatewayError', status: 429 },
    )
  })

  it('throws NetworkError when fetch itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const gateway = new HttpFreesoundGateway({ apiKey: 'k', fetchImpl })

    await expect(
      gateway.search({ query: 'x', page: 1, pageSize: 15 }),
    ).rejects.toBeInstanceOf(NetworkError)
  })

  it('does not implement the later-ticket methods yet', async () => {
    const gateway = new HttpFreesoundGateway({ apiKey: 'k' })
    await expect(gateway.getPreviewStream()).rejects.toBeInstanceOf(NotImplemented)
  })

  // Keep GatewayError referenced for clarity of intent.
  it('GatewayError carries an HTTP status', () => {
    expect(new GatewayError('m', 500).status).toBe(500)
  })
})
