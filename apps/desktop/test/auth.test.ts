// Ticket 07 — OAuth sign-in / sign-out, at the core seam. No Electron: a fake
// AuthPlatform (browser + loopback + safeStorage), a fake Scheduler (timers),
// the fake FreesoundGateway, and a real in-process SQLite database.
//
// Covers exactly spec 0001 § Testing Decisions > Auth:
//   - sign-in stores an ENCRYPTED refresh token
//   - proactive refresh fires before expiry, with no user action
//   - a 401 triggers EXACTLY one refresh and one retry
//   - a failed refresh signs out cleanly and does NOT loop
//   - sign-out preserves the Library
//   - port-in-use surfaces the specific named error
//   - a `state` mismatch on the callback is rejected
//   - signed-out: search is rejected (NotSignedInError) and never hits the gateway

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/core/db/index'
import {
  createAuthController,
  type AuthControllerDeps,
} from '../src/core/auth/authController'
import {
  OAuthStateMismatchError,
  ReauthRequiredError,
} from '../src/core/auth/errors'
import { FakeFreesoundGateway } from '../src/core/gateway/fake'
import { FakeAuthPlatform } from './helpers/fakeAuthPlatform'
import { FakeScheduler } from './helpers/fakeScheduler'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

const REDIRECT_URI = 'http://localhost:8910/callback'

const openDbs: DB[] = []
afterEach(() => {
  for (const db of openDbs.splice(0)) {
    try {
      db.close()
    } catch {
      /* already closed */
    }
  }
})

function setup(
  gatewayCfg: ConstructorParameters<typeof FakeFreesoundGateway>[0] = {},
  ctrlCfg: Partial<AuthControllerDeps> = {},
  db: DB = openDb(':memory:'),
) {
  openDbs.push(db)
  const gateway = new FakeFreesoundGateway(gatewayCfg)
  const platform = new FakeAuthPlatform()
  const scheduler = new FakeScheduler()
  const events: string[] = []
  const controller = createAuthController({
    gateway,
    platform,
    scheduler,
    db,
    clientId: 'client-abc',
    onStateChange: (s) => events.push(s.status),
    refreshMarginMs: 60_000,
    signInTimeoutMs: 120_000,
    transientRetryMs: 30_000,
    ...ctrlCfg,
  })
  return { db, gateway, platform, scheduler, controller, events }
}

describe('sign-in', () => {
  it('opens the system browser at the Freesound authorize URL with client_id, response_type and state', async () => {
    const { controller, platform } = setup({ username: 'alice' })
    await controller.signIn()

    expect(platform.openedUrls).toHaveLength(1)
    const url = new URL(platform.openedUrls[0]!)
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://freesound.org/apiv2/oauth2/authorize/',
    )
    expect(url.searchParams.get('client_id')).toBe('client-abc')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/)
  })

  it('exchanges the code via the Worker with the single registered redirect URI, and shows the username', async () => {
    const { controller, gateway } = setup({ username: 'alice' })
    const state = await controller.signIn()

    expect(gateway.exchangeCalls).toEqual([['fake-code', REDIRECT_URI]])
    expect(state.status).toBe('signedIn')
    expect(state.username).toBe('alice')
    expect(controller.getState().username).toBe('alice')
  })

  it('stores an ENCRYPTED refresh token — the plaintext never hits the auth table', async () => {
    const { controller, platform, db, scheduler } = setup({
      refreshToken: 'super-secret-refresh-token',
      username: 'alice',
    })
    await controller.signIn()

    // The refresh token plaintext was handed to AuthPlatform.encrypt.
    const lastEncInput = platform.encryptInputs.at(-1)!.toString('utf8')
    expect(lastEncInput).toContain('super-secret-refresh-token')

    const row = db
      .prepare(
        'SELECT refresh_token_enc AS enc, access_token_expires AS exp FROM auth WHERE id = 1',
      )
      .get() as { enc: Buffer; exp: number }

    expect(Buffer.isBuffer(row.enc)).toBe(true)
    // What is on disk went through encrypt (the fake's marker) ...
    expect(row.enc.toString('utf8').startsWith('FAKEENC:')).toBe(true)
    // ... and is NOT the plaintext token or username.
    expect(row.enc.toString('utf8')).not.toContain('super-secret-refresh-token')
    // Access-token expiry is persisted; the access token itself is not.
    expect(row.exp).toBeGreaterThan(scheduler.now())
    expect(row.exp).toBe(scheduler.now() + 86_400_000)
    const dump = JSON.stringify(row)
    expect(dump).not.toContain('fake-access-token')
  })

  it('rejects a callback whose state does not match, and exchanges nothing', async () => {
    const { controller, platform, gateway } = setup()
    platform.loopback = { code: 'abc', state: 'a-different-state' }

    await expect(controller.signIn()).rejects.toBeInstanceOf(
      OAuthStateMismatchError,
    )
    expect(gateway.exchangeCalls).toHaveLength(0)
    expect(controller.getState().status).toBe('signedOut')
  })

  it('fails with a specific, port-naming error when the loopback port is already in use', async () => {
    const { controller, platform } = setup()
    platform.portInUse = true

    await expect(controller.signIn()).rejects.toMatchObject({
      name: 'LoopbackPortInUseError',
      port: 8910,
      message: expect.stringContaining('8910'),
    })
    await expect(controller.signIn()).rejects.toMatchObject({
      message: expect.stringContaining('already in use'),
    })
    expect(controller.getState().status).toBe('signedOut')
  })

  it('rejects cleanly when the sign-in wait times out', async () => {
    const { controller, platform, scheduler } = setup()
    platform.hang = true

    const assertion = expect(controller.signIn()).rejects.toMatchObject({
      name: 'SignInCancelledError',
    })
    await scheduler.advance(120_000) // trip the sign-in timeout
    await assertion
    expect(controller.getState().status).toBe('signedOut')
  })
})

describe('proactive refresh', () => {
  it('fires before the access token expires, with no user involvement', async () => {
    const { controller, gateway, scheduler } = setup({ username: 'bob' })
    await controller.signIn()
    expect(gateway.refreshCalls).toHaveLength(0)

    // Scheduled at expiry (86400s) minus the 60s margin. Advance just past it —
    // the ONLY thing that happens is the clock moving.
    await scheduler.advance(86_400_000 - 60_000 + 1_000)

    expect(gateway.refreshCalls).toHaveLength(1)
    expect(controller.getState().status).toBe('signedIn')

    // The refreshed access token is what the next authenticated call uses.
    let usedToken = ''
    await controller.authorized(async (t) => {
      usedToken = t
      return null
    })
    expect(usedToken).toBe('fake-access-token-1')
  })

  it('reschedules after a successful proactive refresh', async () => {
    const { controller, gateway, scheduler } = setup({ username: 'bob' })
    await controller.signIn()

    await scheduler.advance(86_400_000) // first proactive refresh
    expect(gateway.refreshCalls).toHaveLength(1)

    await scheduler.advance(86_400_000) // the next one it scheduled
    expect(gateway.refreshCalls).toHaveLength(2)
  })
})

describe('401 interceptor', () => {
  it('a 401 triggers EXACTLY one refresh and EXACTLY one retry', async () => {
    const { controller, gateway } = setup({ username: 'carol' })
    await controller.signIn()
    gateway.armGetMeUnauthorized(1)

    let attempts = 0
    const profile = await controller.authorized(async (token) => {
      attempts++
      return gateway.getMe(token)
    })

    expect(attempts).toBe(2) // original + one retry, no third
    expect(gateway.refreshCalls).toHaveLength(1) // one refresh, no loop
    expect(profile.username).toBe('carol')
    expect(controller.getState().status).toBe('signedIn')
  })

  it('if the retry still 401s, it signs out (and still only refreshed once)', async () => {
    const { controller, gateway } = setup({ username: 'carol' })
    await controller.signIn()
    gateway.armGetMeUnauthorized(5)

    let attempts = 0
    await expect(
      controller.authorized(async (token) => {
        attempts++
        return gateway.getMe(token)
      }),
    ).rejects.toMatchObject({ status: 401 })

    expect(attempts).toBe(2)
    expect(gateway.refreshCalls).toHaveLength(1)
    expect(controller.getState().status).toBe('signedOut')
    expect(controller.getState().reauthRequired).toBe(true)
  })
})

describe('failed refresh', () => {
  it('a proactive refresh that fails with reauthorize signs out cleanly and does NOT loop', async () => {
    const { controller, gateway, scheduler } = setup({ username: 'dave' })
    await controller.signIn()
    gateway.setRefreshMode('reauthorize')

    await scheduler.advance(86_400_000 * 2)

    expect(gateway.refreshCalls).toHaveLength(1) // called once — no retry loop
    expect(scheduler.pending).toBe(0) // nothing rescheduled
    const state = controller.getState()
    expect(state.status).toBe('signedOut')
    expect(state.reauthRequired).toBe(true) // one-click "sign in again" prompt
  })

  it('a 401 whose refresh then fails with reauthorize signs out, once', async () => {
    const { controller, gateway } = setup({ username: 'dave' })
    await controller.signIn()
    gateway.armGetMeUnauthorized(1)
    gateway.setRefreshMode('reauthorize')

    await expect(
      controller.authorized((token) => gateway.getMe(token)),
    ).rejects.toBeInstanceOf(ReauthRequiredError)

    expect(gateway.refreshCalls).toHaveLength(1)
    expect(controller.getState().status).toBe('signedOut')
    expect(controller.getState().reauthRequired).toBe(true)
  })

  it('a transient refresh failure keeps the session and does not sign out', async () => {
    const { controller, gateway, scheduler } = setup({ username: 'dave' })
    await controller.signIn()
    gateway.setRefreshMode('retry')

    await scheduler.advance(86_400_000)

    expect(controller.getState().status).toBe('signedIn') // still signed in
    expect(gateway.refreshCalls.length).toBeGreaterThanOrEqual(1)
  })
})

describe('session persistence', () => {
  it('restores a signed-in session from the encrypted store on construction and refreshes on demand', async () => {
    const db = openDb(':memory:')
    openDbs.push(db)

    const first = setup({ username: 'eve', refreshToken: 'rt-eve' }, {}, db)
    await first.controller.signIn()
    first.controller.close()

    // A brand-new controller on the SAME database — simulates a relaunch.
    const g2 = new FakeFreesoundGateway({ username: 'eve' })
    const c2 = createAuthController({
      gateway: g2,
      platform: new FakeAuthPlatform(),
      scheduler: new FakeScheduler(),
      db,
      clientId: 'client-abc',
    })

    expect(c2.getState().status).toBe('signedIn')
    expect(c2.getState().username).toBe('eve')

    // The access token was in-memory only, so the first authenticated call
    // refreshes before proceeding — without any user action.
    await c2.authorized((t) => g2.getMe(t))
    expect(g2.refreshCalls).toHaveLength(1)
    c2.close()
  })
})

describe('sign-out', () => {
  it('clears the stored tokens but leaves the Library and downloaded files intact', async () => {
    const gateway = makeFakeGateway()
    const { core, dataDir, dbPath } = await makeTestCore({ gateway })

    await core.signIn()
    expect(core.getAuthState().status).toBe('signedIn')
    await core.search('rain') // populates `sounds`

    const seed = openDb(dbPath)
    openDbs.push(seed)
    const soundId = (
      seed.prepare('SELECT id FROM sounds LIMIT 1').get() as { id: number }
    ).id
    seed
      .prepare('INSERT INTO library_entries (sound_id, saved_at) VALUES (?, ?)')
      .run(soundId, Date.now())
    const filePath = join(dataDir, `${soundId}.wav`)
    writeFileSync(filePath, 'RIFF----fake-original-audio')
    seed.close()

    await core.signOut()

    expect(core.getAuthState().status).toBe('signedOut')

    const check = openDb(dbPath)
    openDbs.push(check)
    expect(
      (check.prepare('SELECT COUNT(*) AS n FROM auth').get() as { n: number }).n,
    ).toBe(0)
    expect(
      (
        check
          .prepare('SELECT COUNT(*) AS n FROM library_entries')
          .get() as { n: number }
      ).n,
    ).toBe(1)
    expect(
      (check.prepare('SELECT COUNT(*) AS n FROM sounds').get() as { n: number })
        .n,
    ).toBeGreaterThan(0)
    check.close()

    expect(existsSync(filePath)).toBe(true) // the downloaded Original survives
  })
})

describe('signed-out usability', () => {
  it('search is rejected while signed out and never reaches the gateway (ADR-0004: no bundled API key)', async () => {
    const gateway = makeFakeGateway()
    const { core } = await makeTestCore({ gateway })

    await expect(core.search('rain')).rejects.toMatchObject({
      name: 'NotSignedInError',
    })

    expect(core.getAuthState().status).toBe('signedOut')
    // Nothing hit the network — not the search endpoint, not the OAuth paths.
    expect(gateway.calls).toHaveLength(0)
    expect(gateway.refreshCalls).toHaveLength(0)
    expect(gateway.exchangeCalls).toHaveLength(0)
  })

  it('the Library still reads while signed out', async () => {
    const { core } = await makeTestCore({ gateway: makeFakeGateway() })
    // A local-only read must not throw just because there is no session.
    expect(core.listLibrary()).toEqual([])
    expect(core.getAuthState().status).toBe('signedOut')
  })
})
