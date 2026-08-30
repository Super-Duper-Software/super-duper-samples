import { describe, expect, it, vi } from 'vitest'
import { NotImplemented } from '../src/core'
import {
  ReauthRequiredError,
  RetryableTokenError,
} from '../src/core/auth/errors'
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

  it('later-ticket streaming/download methods still throw NotImplemented', async () => {
    const gateway = new FakeFreesoundGateway()
    await expect(gateway.getPreviewStream()).rejects.toBeInstanceOf(NotImplemented)
    await expect(gateway.downloadOriginal()).rejects.toBeInstanceOf(NotImplemented)
  })

  it('implements the ticket-07 OAuth methods', async () => {
    const gateway = new FakeFreesoundGateway({ username: 'zoe' })

    const tokens = await gateway.exchangeToken('the-code', 'http://localhost:8910/callback')
    expect(tokens.accessToken).toBe('fake-access-token')
    expect(tokens.refreshToken).toBe('fake-refresh-token')
    expect(gateway.exchangeCalls).toEqual([['the-code', 'http://localhost:8910/callback']])

    const refreshed = await gateway.refreshToken('fake-refresh-token')
    expect(refreshed.accessToken).toBe('fake-access-token-1')
    expect(gateway.refreshCalls).toEqual(['fake-refresh-token'])

    expect(await gateway.getMe('fake-access-token')).toEqual({ username: 'zoe' })
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

describe('HttpFreesoundGateway — token Worker (ticket 07)', () => {
  function jsonResponse(status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response
  }

  it('POSTs the code to ${workerUrl}/exchange and normalizes the token set', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        access_token: 'AT',
        refresh_token: 'RT',
        expires_in: 86400,
        scope: 'read write',
        token_type: 'Bearer',
      }),
    )
    const gateway = new HttpFreesoundGateway({
      apiKey: 'k',
      tokenWorkerUrl: 'https://worker.example.dev/',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const tokens = await gateway.exchangeToken('the-code', 'http://localhost:8910/callback')

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://worker.example.dev/exchange')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      code: 'the-code',
      redirect_uri: 'http://localhost:8910/callback',
    })
    expect(tokens).toEqual({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresIn: 86400,
      scope: 'read write',
      tokenType: 'Bearer',
    })
  })

  it('maps the Worker’s {error:"reauthorize"} to ReauthRequiredError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, {
        error: 'reauthorize',
        upstream_status: 401,
        detail: 'invalid_grant',
      }),
    ) as unknown as typeof fetch
    const gateway = new HttpFreesoundGateway({
      apiKey: 'k',
      tokenWorkerUrl: 'https://worker.example.dev',
      fetchImpl,
    })

    await expect(gateway.refreshToken('dead-rt')).rejects.toBeInstanceOf(
      ReauthRequiredError,
    )
  })

  it('maps the Worker’s {error:"retry"} to RetryableTokenError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, { error: 'retry', upstream_status: 502, detail: 'bad gateway' }),
    ) as unknown as typeof fetch
    const gateway = new HttpFreesoundGateway({
      apiKey: 'k',
      tokenWorkerUrl: 'https://worker.example.dev',
      fetchImpl,
    })

    await expect(gateway.refreshToken('rt')).rejects.toBeInstanceOf(
      RetryableTokenError,
    )
  })

  it('treats an unreachable Worker as retryable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const gateway = new HttpFreesoundGateway({
      apiKey: 'k',
      tokenWorkerUrl: 'https://worker.example.dev',
      fetchImpl,
    })

    await expect(gateway.exchangeToken('c', 'r')).rejects.toBeInstanceOf(
      RetryableTokenError,
    )
  })

  it('getMe sends a Bearer token and returns the username; a 401 is a GatewayError(401)', async () => {
    const ok = vi.fn(async () => jsonResponse(200, { username: 'grace' }))
    const okGateway = new HttpFreesoundGateway({
      apiKey: 'k',
      fetchImpl: ok as unknown as typeof fetch,
    })
    expect(await okGateway.getMe('AT')).toEqual({ username: 'grace' })
    const [meUrl, meInit] = ok.mock.calls[0] as unknown as [URL, RequestInit]
    expect(meUrl.toString()).toBe('https://freesound.org/apiv2/me/')
    expect((meInit.headers as Record<string, string>).Authorization).toBe('Bearer AT')

    const unauth = vi.fn(async () =>
      jsonResponse(401, { detail: 'expired' }),
    ) as unknown as typeof fetch
    const unauthGateway = new HttpFreesoundGateway({ apiKey: 'k', fetchImpl: unauth })
    await expect(unauthGateway.getMe('AT')).rejects.toMatchObject({
      name: 'GatewayError',
      status: 401,
    })
  })

  it('exchangeToken without a configured Worker URL fails clearly', async () => {
    const gateway = new HttpFreesoundGateway({ apiKey: 'k' })
    await expect(gateway.exchangeToken('c', 'r')).rejects.toThrow(
      /FREESOUND_TOKEN_WORKER_URL/,
    )
  })
})
