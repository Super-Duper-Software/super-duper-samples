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

    const page = await gateway.search(
      { query: 'rain', page: 1, pageSize: 15 },
      'tok',
    )

    expect(page.count).toBeGreaterThan(0)
    expect(page.results.length).toBe(3)
    expect(gateway.searchCallCount).toBe(1)
    expect(gateway.calls[0]).toEqual({ query: 'rain', page: 1, pageSize: 15 })
    expect(gateway.searchTokens).toEqual(['tok'])
  })

  it('the ticket-04 preview stream still throws NotImplemented', async () => {
    const gateway = new FakeFreesoundGateway()
    await expect(gateway.getPreviewStream()).rejects.toBeInstanceOf(NotImplemented)
  })

  it('downloadOriginal returns bytes, records the call, and tracks concurrency', async () => {
    const gateway = new FakeFreesoundGateway({ downloadDelayMs: 20 })

    const [a, b] = await Promise.all([
      gateway.downloadOriginal(1, 'AT'),
      gateway.downloadOriginal(2, 'AT'),
    ])

    expect(new TextDecoder().decode(a.bytes)).toBe('FAKE-ORIGINAL:1')
    expect(new TextDecoder().decode(b.bytes)).toBe('FAKE-ORIGINAL:2')
    expect(gateway.downloadCalls).toEqual([
      { soundId: 1, accessToken: 'AT' },
      { soundId: 2, accessToken: 'AT' },
    ])
    expect(gateway.downloadMaxConcurrent).toBe(2)
    expect(gateway.downloadInFlight).toBe(0)
  })

  it('downloadOriginal rejects with an AbortError when the signal fires mid-flight', async () => {
    const gateway = new FakeFreesoundGateway({ downloadDelayMs: 1000 })
    const ac = new AbortController()
    const p = gateway.downloadOriginal(7, 'AT', { signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('downloadOriginal can be armed for transient-then-success and permanent failure', async () => {
    const transient = new FakeFreesoundGateway({ downloadTransientFailures: 2 })
    await expect(transient.downloadOriginal(9, 'AT')).rejects.toMatchObject({ status: 503 })
    await expect(transient.downloadOriginal(9, 'AT')).rejects.toMatchObject({ status: 503 })
    expect((await transient.downloadOriginal(9, 'AT')).bytes.byteLength).toBeGreaterThan(0)

    const permanent = new FakeFreesoundGateway({ downloadPermanentFail: true })
    await expect(permanent.downloadOriginal(9, 'AT')).rejects.toMatchObject({ status: 500 })
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

  it('requests search/text with the user Bearer token and exactly the row field set', async () => {
    const fetchImpl = vi.fn(
      (_url: URL, _init?: RequestInit) =>
        Promise.resolve(fakeResponse(loadFixture('search-rain.json'))),
    )
    const gateway = new HttpFreesoundGateway({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    await gateway.search({ query: 'rain', page: 2, pageSize: 15 }, 'user-access-token')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchImpl.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toContain('https://freesound.org/apiv2/search/text/')
    expect(url.searchParams.get('query')).toBe('rain')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('15')
    expect(url.searchParams.get('fields')).toBe(SEARCH_FIELDS)
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      'Bearer user-access-token',
    )
  })

  it('throws GatewayError on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({}, { ok: false, status: 429 }),
    ) as unknown as typeof fetch
    const gateway = new HttpFreesoundGateway({ fetchImpl })

    await expect(gateway.search({ query: 'x', page: 1, pageSize: 15 }, 'tok')).rejects.toMatchObject(
      { name: 'GatewayError', status: 429 },
    )
  })

  it('throws NetworkError when fetch itself rejects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    const gateway = new HttpFreesoundGateway({ fetchImpl })

    await expect(
      gateway.search({ query: 'x', page: 1, pageSize: 15 }, 'tok'),
    ).rejects.toBeInstanceOf(NetworkError)
  })

  it('does not implement the ticket-04 preview stream yet', async () => {
    const gateway = new HttpFreesoundGateway()
    await expect(gateway.getPreviewStream()).rejects.toBeInstanceOf(NotImplemented)
  })

  it('downloadOriginal GETs sounds/<id>/download/ with a Bearer token and streams the body', async () => {
    const payload = new TextEncoder().encode('RIFF....realwav')
    const fetchImpl = vi.fn(async (_url: URL) => ({
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h === 'content-type' ? 'audio/x-wav' : null) },
      body: {
        getReader() {
          let sent = false
          return {
            read: async () =>
              sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: payload }),
            cancel: async () => {},
          }
        },
      },
    })) as unknown as typeof fetch
    const gateway = new HttpFreesoundGateway({ fetchImpl })

    const res = await gateway.downloadOriginal(442827, 'the-access-token')

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [URL, RequestInit][] } }).mock.calls[0]!
    expect(url.toString()).toBe('https://freesound.org/apiv2/sounds/442827/download/')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer the-access-token')
    expect(new TextDecoder().decode(res.bytes)).toBe('RIFF....realwav')
    expect(res.contentType).toBe('audio/x-wav')
  })

  it('downloadOriginal surfaces a 401 as GatewayError(401) so authorized() can refresh + retry', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      headers: { get: () => null },
    })) as unknown as typeof fetch
    const gateway = new HttpFreesoundGateway({ fetchImpl })
    await expect(gateway.downloadOriginal(1, 'stale')).rejects.toMatchObject({
      name: 'GatewayError',
      status: 401,
    })
  })

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
      fetchImpl: ok as unknown as typeof fetch,
    })
    expect(await okGateway.getMe('AT')).toEqual({ username: 'grace' })
    const [meUrl, meInit] = ok.mock.calls[0] as unknown as [URL, RequestInit]
    expect(meUrl.toString()).toBe('https://freesound.org/apiv2/me/')
    expect((meInit.headers as Record<string, string>).Authorization).toBe('Bearer AT')

    const unauth = vi.fn(async () =>
      jsonResponse(401, { detail: 'expired' }),
    ) as unknown as typeof fetch
    const unauthGateway = new HttpFreesoundGateway({ fetchImpl: unauth })
    await expect(unauthGateway.getMe('AT')).rejects.toMatchObject({
      name: 'GatewayError',
      status: 401,
    })
  })

  it('exchangeToken without a configured Worker URL fails clearly', async () => {
    const gateway = new HttpFreesoundGateway()
    await expect(gateway.exchangeToken('c', 'r')).rejects.toThrow(
      /FREESOUND_TOKEN_WORKER_URL/,
    )
  })
})
