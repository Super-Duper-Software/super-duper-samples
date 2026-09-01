// Ticket 08 — staged download on audition, at the core seam. No Electron: the
// fake gateway (configurable downloads + spies), the fake AuthPlatform + fake
// Scheduler, a real temp SQLite database and a real temp filesystem.
//
// Covers exactly the ticket's list:
//   - auditioning enqueues a background download; Preview playback is untouched
//   - moving on quickly cancels it (in-flight abort + queued removal), and
//     skimming N sounds does not leave N downloads running/queued
//   - concurrency is capped (observed max <= limit)
//   - a Sound becomes `ready` once its Original + sidecar are on disk
//   - transient failure retries (advance scheduler) then succeeds
//   - permanent failure surfaces as `failed`, distinct from downloading
//   - nothing is staged while signed out
//   - nothing is staged before consent is granted; after grant it is
//   - `staged_entries` row written with size + last-accessed; re-audition touches it
//   - an authenticated download 401 → exactly one refresh + one retry, not a loop

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb, type DB } from '../src/core/db/index'
import { FakeFreesoundGateway } from '../src/core/gateway/fake'
import {
  createDownloadQueue,
  DOWNLOAD_CONCURRENCY,
  type StagingStatus,
} from '../src/core/staging/downloadQueue'
import type { Sidecar } from '../src/core/staging/contentStore'
import { FakeScheduler } from './helpers/fakeScheduler'
import { makeFakeGateway, makeTestCore } from './helpers/makeTestCore'

const RAIN = { id: 321967, ext: 'wav', author: 'klankbeeld', license: 'CC-BY' }

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

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

async function waitUntil(pred: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('waitUntil timed out')
    await sleep(5)
  }
}

/** A test core that is signed in and (by default) has granted staging consent. */
async function signedInCore(
  opts: Parameters<typeof makeTestCore>[0] = {},
  { consent = true }: { consent?: boolean } = {},
) {
  const gateway = (opts.gateway as FakeFreesoundGateway | undefined) ?? makeFakeGateway()
  const tc = await makeTestCore({ ...opts, gateway })
  cleanups.push(() => tc.core.close())
  await tc.core.signIn()
  if (consent) tc.core.grantStagingConsent()
  return { ...tc, gateway }
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

// ───────────────────────────── DownloadQueue (unit) ─────────────────────────

describe('DownloadQueue', () => {
  it('never runs more than the concurrency limit at once', async () => {
    const gateway = new FakeFreesoundGateway({ downloadDelayMs: 25 })
    const q = createDownloadQueue({
      scheduler: new FakeScheduler(),
      runDownload: (id, signal) => gateway.downloadOriginal(id, 'AT', { signal }),
      onComplete: () => {},
    })

    for (let id = 1; id <= 12; id++) q.enqueue(id)
    await waitUntil(() => q.tracked().length === 0)

    expect(gateway.downloadCallCount).toBe(12)
    expect(gateway.downloadMaxConcurrent).toBeLessThanOrEqual(DOWNLOAD_CONCURRENCY)
    expect(gateway.downloadMaxConcurrent).toBe(DOWNLOAD_CONCURRENCY)
  })

  it('cancel() removes a queued job and aborts an in-flight one', async () => {
    const gateway = new FakeFreesoundGateway({ downloadDelayMs: 1000 })
    const q = createDownloadQueue({
      scheduler: new FakeScheduler(),
      concurrency: 1,
      runDownload: (id, signal) => gateway.downloadOriginal(id, 'AT', { signal }),
      onComplete: () => {},
    })

    q.enqueue(1)
    q.enqueue(2)
    q.enqueue(3)
    await waitUntil(() => q.status(1) === 'downloading')
    expect(q.status(2)).toBe('queued')

    q.cancel(2) // queued → gone
    expect(q.status(2)).toBe('not-started')
    expect(q.tracked()).not.toContain(2)

    q.cancel(1) // in-flight → aborted, slot freed, 3 starts
    expect(q.status(1)).toBe('not-started')
    await waitUntil(() => q.status(3) === 'downloading')
  })

  it('retries a transient failure with backoff, then succeeds', async () => {
    const scheduler = new FakeScheduler()
    const gateway = new FakeFreesoundGateway({ downloadTransientFailures: 2 })
    const seen: StagingStatus[] = []
    const q = createDownloadQueue({
      scheduler,
      backoffMs: [0, 0, 0],
      runDownload: (id, signal) => gateway.downloadOriginal(id, 'AT', { signal }),
      onComplete: () => {},
      onStatusChange: (_id, s) => seen.push(s),
    })

    q.enqueue(5)
    for (let i = 0; i < 8; i++) await scheduler.advance(1)

    expect(gateway.downloadCallCount).toBe(3) // 1 + 2 retries
    expect(seen.filter((s) => s === 'downloading')).toHaveLength(3)
    expect(seen.at(-1)).toBe('ready')
  })

  it('marks a Sound `failed` once retries are exhausted (distinct from downloading)', async () => {
    const scheduler = new FakeScheduler()
    const gateway = new FakeFreesoundGateway({ downloadPermanentFail: true })
    const seen: StagingStatus[] = []
    const q = createDownloadQueue({
      scheduler,
      maxRetries: 2,
      backoffMs: [0, 0],
      runDownload: (id, signal) => gateway.downloadOriginal(id, 'AT', { signal }),
      onComplete: () => {},
      onStatusChange: (_id, s) => seen.push(s),
    })

    q.enqueue(9)
    for (let i = 0; i < 8; i++) await scheduler.advance(1)

    expect(gateway.downloadCallCount).toBe(3) // 1 + 2 retries
    expect(q.status(9)).toBe('failed')
    expect(seen.at(-1)).toBe('failed')
  })
})

// ─────────────────────────── core.stageOnAudition ───────────────────────────

describe('core.stageOnAudition', () => {
  it('enqueues a background download and the Sound becomes `ready` with its Original + sidecar on disk', async () => {
    const events: Array<{ soundId: number; status: string }> = []
    const { core, gateway, dataDir } = await signedInCore({
      onStagingStatusChange: (c) => events.push(c),
    })
    await core.search('rain')

    core.stageOnAudition(RAIN.id)
    await waitUntil(() => core.getStagingStatus([RAIN.id])[RAIN.id] === 'ready')

    const contentDir = join(dataDir, 'content')
    const original = join(contentDir, `${RAIN.id}.${RAIN.ext}`)
    const sidecarPath = join(contentDir, `${RAIN.id}.json`)

    // file bytes match what the gateway served
    expect(readFileSync(original, 'utf8')).toBe(`FAKE-ORIGINAL:${RAIN.id}`)

    // sidecar carries author / license / freesound URL and enough to rebuild a row
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Sidecar
    expect(sidecar.author.username).toBe(RAIN.author)
    expect(sidecar.license.name).toBe(RAIN.license)
    expect(sidecar.license.url).toMatch(/creativecommons\.org/)
    expect(sidecar.freesoundUrl).toContain(`/${RAIN.id}/`)
    expect(sidecar.sound.id).toBe(RAIN.id)

    // atomic rename left no partial temp file behind
    expect(readdirSync(contentDir).some((f) => f.endsWith('.part'))).toBe(false)

    // status event stream: queued → downloading → ready
    const forSound = events.filter((e) => e.soundId === RAIN.id).map((e) => e.status)
    expect(forSound).toEqual(['queued', 'downloading', 'ready'])

    // exactly one download call for this Sound
    expect(gateway.downloadCalls.filter((c) => c.soundId === RAIN.id)).toHaveLength(1)
  })

  it('writes a staged_entries row with size + last-accessed, and a re-audition bumps last-accessed only', async () => {
    const { core, gateway, dbPath } = await signedInCore()
    await core.search('rain')

    core.stageOnAudition(RAIN.id)
    await waitUntil(() => core.getStagingStatus([RAIN.id])[RAIN.id] === 'ready')

    const db = openTemp(dbPath)
    const row1 = db
      .prepare('SELECT * FROM staged_entries WHERE sound_id = ?')
      .get(RAIN.id) as {
      byte_size: number
      last_access_at: number
      created_at: number
      path: string
    }
    expect(row1.byte_size).toBe(`FAKE-ORIGINAL:${RAIN.id}`.length)
    expect(row1.path).toContain(`${RAIN.id}.${RAIN.ext}`)
    expect(row1.created_at).toBeGreaterThan(0)
    expect(row1.last_access_at).toBeGreaterThan(0)
    const callsAfterFirst = gateway.downloadCallCount

    await sleep(8)
    core.stageOnAudition(RAIN.id) // re-audition: already on disk

    const row2 = db
      .prepare('SELECT * FROM staged_entries WHERE sound_id = ?')
      .get(RAIN.id) as { last_access_at: number; created_at: number }
    expect(row2.last_access_at).toBeGreaterThan(row1.last_access_at)
    expect(row2.created_at).toBe(row1.created_at) // created_at is not moved
    expect(gateway.downloadCallCount).toBe(callsAfterFirst) // no second download
  })

  it('moving past a Sound quickly cancels its in-flight download', async () => {
    const { core } = await signedInCore({ gateway: makeFakeGateway({ downloadDelayMs: 200 }) })
    await core.search('rain')

    core.stageOnAudition(321967)
    await waitUntil(() => core.getStagingStatus([321967])[321967] === 'downloading')

    core.stageOnAudition(408535) // skip on — cancels 321967
    expect(core.getStagingStatus([321967])[321967]).toBe('not-started')

    await sleep(60)
    // 321967 never lands; 408535 is the live one
    expect(core.getStagingStatus([321967])[321967]).toBe('not-started')
    expect(['queued', 'downloading', 'ready']).toContain(
      core.getStagingStatus([408535])[408535],
    )
  })

  it('skimming a list does not leave a download per row running or queued', async () => {
    const { core, gateway, dataDir } = await signedInCore({
      gateway: makeFakeGateway({ downloadDelayMs: 120 }),
    })
    // 6 distinct sounds across two pages
    await core.search('loops', { page: 1, pageSize: 3 })
    await core.search('loops', { page: 2, pageSize: 3 })
    const ids = [500001, 500002, 500003, 500004, 500005, 500006]

    for (const id of ids) core.stageOnAudition(id) // skim, back to back

    const nowStatuses = core.getStagingStatus(ids)
    const live = ids.filter((id) =>
      ['queued', 'downloading'].includes(nowStatuses[id] as string),
    )
    expect(live.length).toBeLessThanOrEqual(1) // only the last audition survives
    expect(gateway.downloadMaxConcurrent).toBeLessThanOrEqual(DOWNLOAD_CONCURRENCY)

    await waitUntil(
      () =>
        ids.every((id) =>
          ['not-started', 'ready'].includes(
            core.getStagingStatus([id])[id] as string,
          ),
        ),
      5000,
    )
    const ready = ids.filter((id) => core.getStagingStatus([id])[id] === 'ready')
    expect(ready).toEqual([500006])
    // far fewer downloads than rows skimmed
    expect(gateway.downloadCallCount).toBeLessThan(ids.length)
    expect(readdirSync(join(dataDir, 'content')).filter((f) => f.endsWith('.flac'))).toEqual([
      '500006.flac',
    ])
  })

  it('an authenticated download 401 triggers exactly one refresh and one retry, not a loop', async () => {
    const { core, gateway, dataDir } = await signedInCore({
      gateway: makeFakeGateway({ downloadUnauthorizedTimes: 1 }),
    })
    await core.search('rain')

    core.stageOnAudition(RAIN.id)
    await waitUntil(() => core.getStagingStatus([RAIN.id])[RAIN.id] === 'ready')

    expect(gateway.refreshCalls).toHaveLength(1) // one refresh, no loop
    expect(gateway.downloadCalls.filter((c) => c.soundId === RAIN.id)).toHaveLength(2) // original + retry
    expect(readFileSync(join(dataDir, 'content', `${RAIN.id}.wav`), 'utf8')).toBe(
      `FAKE-ORIGINAL:${RAIN.id}`,
    )
  })
})

// ───────────────────────── signed-out / consent gate ────────────────────────

describe('staging gates', () => {
  it('does not stage anything while signed out (auditioning still works)', async () => {
    const gateway = makeFakeGateway()
    const { core, dataDir, dbPath } = await makeTestCore({ signedIn: true, gateway })
    cleanups.push(() => core.close())
    core.grantStagingConsent()

    // Seed a Sound row while signed in, then sign out for the actual assertion:
    // search itself now needs a session (ADR-0004), staging is what must stay off.
    const result = await core.search('rain')
    expect(result.sounds.length).toBeGreaterThan(0)
    await core.signOut()

    core.stageOnAudition(RAIN.id)
    await sleep(60)

    expect(gateway.downloadCallCount).toBe(0)
    expect(core.getStagingStatus([RAIN.id])[RAIN.id]).toBe('not-started')
    expect(() => readdirSync(join(dataDir, 'content'))).toThrow() // dir never created

    const db = openTemp(dbPath)
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM staged_entries').get() as { n: number }).n,
    ).toBe(0)
  })

  it('does not stage before consent is granted; stages after grantStagingConsent()', async () => {
    const gateway = makeFakeGateway()
    const { core, dataDir } = await signedInCore({ gateway }, { consent: false })
    await core.search('rain')

    core.stageOnAudition(RAIN.id)
    await sleep(50)
    expect(gateway.downloadCallCount).toBe(0)
    expect(core.getStagingConsent().grantedAt).toBeNull()

    core.grantStagingConsent()
    expect(core.getStagingConsent().grantedAt).toBeGreaterThan(0)

    core.stageOnAudition(RAIN.id)
    await waitUntil(() => core.getStagingStatus([RAIN.id])[RAIN.id] === 'ready')
    expect(gateway.downloadCallCount).toBeGreaterThanOrEqual(1)
    expect(readFileSync(join(dataDir, 'content', `${RAIN.id}.wav`), 'utf8')).toBe(
      `FAKE-ORIGINAL:${RAIN.id}`,
    )
  })

  it('grantStagingConsent is idempotent and persists across a reopen', async () => {
    const { core, dbPath } = await signedInCore({}, { consent: false })
    const first = core.grantStagingConsent().grantedAt
    await sleep(5)
    const second = core.grantStagingConsent().grantedAt
    expect(second).toBe(first) // not moved on a second grant

    const db = openTemp(dbPath)
    expect(
      (db.prepare("SELECT value FROM app_meta WHERE key = 'staging_consent_at'").get() as {
        value: string
      }).value,
    ).toBe(String(first))
  })
})

// ─────────────────────────── core.downloadToLibrary ─────────────────────────

describe('core.downloadToLibrary', () => {
  it('downloads the Original, saves it to the Library (no staged row) and logs the download', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    await core.search('rain')

    core.downloadToLibrary(RAIN.id)
    await waitUntil(() => core.getStagingStatus([RAIN.id])[RAIN.id] === 'ready')

    // Original landed on disk.
    const original = join(dataDir, 'content', `${RAIN.id}.${RAIN.ext}`)
    expect(readFileSync(original, 'utf8')).toBe(`FAKE-ORIGINAL:${RAIN.id}`)

    // Saved to the Library, and NOT left Staged.
    expect(core.getLibraryMembership([RAIN.id])[RAIN.id]).toBe(true)
    const db = openTemp(dbPath)
    expect(
      db.prepare('SELECT COUNT(*) AS n FROM staged_entries').get() as { n: number },
    ).toEqual({ n: 0 })

    // Recorded against the rolling quota.
    expect(core.getDownloadsInLast24h()).toBe(1)
  })

  it('needs no staging consent — an explicit download works before the first-run notice', async () => {
    const { core } = await signedInCore({}, { consent: false })
    await core.search('rain')

    core.downloadToLibrary(RAIN.id)
    await waitUntil(() => core.getStagingStatus([RAIN.id])[RAIN.id] === 'ready')

    expect(core.getLibraryMembership([RAIN.id])[RAIN.id]).toBe(true)
  })

  it('does nothing while signed out', async () => {
    const { core } = await makeTestCore({
      signedIn: true,
      gateway: makeFakeGateway(),
    }).then((tc) => {
      cleanups.push(() => tc.core.close())
      return tc
    })
    await core.search('rain') // seed the Sound row while signed in
    await core.signOut()

    core.downloadToLibrary(RAIN.id)
    await sleep(30)

    expect(core.getStagingStatus([RAIN.id])[RAIN.id]).toBe('not-started')
    expect(core.getLibraryMembership([RAIN.id])[RAIN.id]).toBe(false)
    expect(core.getDownloadsInLast24h()).toBe(0)
  })

  it('getDownloadsInLast24h counts only the trailing 24 h', async () => {
    const { core, dbPath } = await signedInCore()
    const db = openTemp(dbPath)
    const now = Date.now()
    db.prepare('INSERT INTO download_log (sound_id, downloaded_at) VALUES (?, ?)').run(
      1,
      now - 2 * 60 * 60 * 1000,
    )
    db.prepare('INSERT INTO download_log (sound_id, downloaded_at) VALUES (?, ?)').run(
      2,
      now - 25 * 60 * 60 * 1000,
    )
    expect(core.getDownloadsInLast24h()).toBe(1)
  })
})
