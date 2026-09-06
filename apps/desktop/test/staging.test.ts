import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FakeFreesoundGateway } from '../src/core/gateway/fake'
import {
  createDownloadQueue,
  DOWNLOAD_CONCURRENCY,
  type StagingStatus,
} from '../src/core/staging/downloadQueue'
import {
  countRows,
  DRIZZLE,
  FakeScheduler,
  getRow,
  LOOP_IDS,
  listContent,
  makeFakeGateway,
  openTempDb,
  originalBytes,
  originalPath,
  RAIN,
  readSidecar,
  sidecarPath,
  signedInCore,
  sleep,
  waitUntil,
} from './helpers'

describe('DownloadQueue', () => {
  it('never runs more than the concurrency limit at once', async () => {
    const gateway = new FakeFreesoundGateway({ downloadDelayMs: 25 })
    const q = createDownloadQueue({
      scheduler: new FakeScheduler(),
      runDownload: (id, signal) =>
        gateway.downloadOriginal(id, 'AT', { signal }),
      onComplete: () => {},
    })

    for (let id = 1; id <= 12; id++) q.enqueue(id)
    await waitUntil(() => q.tracked().length === 0)

    expect(gateway.downloadCallCount).toBe(12)
    expect(gateway.downloadMaxConcurrent).toBeLessThanOrEqual(
      DOWNLOAD_CONCURRENCY,
    )
    expect(gateway.downloadMaxConcurrent).toBe(DOWNLOAD_CONCURRENCY)
  })

  it('cancel() removes a queued job and aborts an in-flight one', async () => {
    const gateway = new FakeFreesoundGateway({ downloadDelayMs: 1000 })
    const q = createDownloadQueue({
      scheduler: new FakeScheduler(),
      concurrency: 1,
      runDownload: (id, signal) =>
        gateway.downloadOriginal(id, 'AT', { signal }),
      onComplete: () => {},
    })

    q.enqueue(1)
    q.enqueue(2)
    q.enqueue(3)
    await waitUntil(() => q.status(1) === 'downloading')
    expect(q.status(2)).toBe('queued')

    q.cancel(2)
    expect(q.status(2)).toBe('not-started')
    expect(q.tracked()).not.toContain(2)

    q.cancel(1)
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
      runDownload: (id, signal) =>
        gateway.downloadOriginal(id, 'AT', { signal }),
      onComplete: () => {},
      onStatusChange: (_id, s) => seen.push(s),
    })

    q.enqueue(5)
    for (let i = 0; i < 8; i++) await scheduler.advance(1)

    expect(gateway.downloadCallCount).toBe(3)
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
      runDownload: (id, signal) =>
        gateway.downloadOriginal(id, 'AT', { signal }),
      onComplete: () => {},
      onStatusChange: (_id, s) => seen.push(s),
    })

    q.enqueue(9)
    for (let i = 0; i < 8; i++) await scheduler.advance(1)

    expect(gateway.downloadCallCount).toBe(3)
    expect(q.status(9)).toBe('failed')
    expect(seen.at(-1)).toBe('failed')
  })
})

describe('core.stageOnAudition', () => {
  it('enqueues a background download and the Sound becomes `ready` with its Original + sidecar on disk', async () => {
    const events: Array<{ soundId: number; status: string }> = []
    const { core, gateway, dataDir } = await signedInCore({
      onStagingStatusChange: (c) => events.push(c),
    })
    await core.search('rain')

    core.stageOnAudition(RAIN.id)
    await waitUntil(() => core.getStagingStatus([RAIN.id])[RAIN.id] === 'ready')

    expect(readFileSync(originalPath(dataDir, RAIN), 'utf8')).toBe(
      originalBytes(RAIN.id),
    )

    const sidecar = readSidecar(sidecarPath(dataDir, RAIN.id))
    expect(sidecar.author.username).toBe(RAIN.author)
    expect(sidecar.license.name).toBe(RAIN.license)
    expect(sidecar.license.url).toMatch(/creativecommons\.org/)
    expect(sidecar.freesoundUrl).toContain(`/${RAIN.id}/`)
    expect(sidecar.sound.id).toBe(RAIN.id)

    expect(listContent(dataDir).some((f) => f.endsWith('.part'))).toBe(false)

    const forSound = events
      .filter((e) => e.soundId === RAIN.id)
      .map((e) => e.status)
    expect(forSound).toEqual(['queued', 'downloading', 'ready'])

    expect(
      gateway.downloadCalls.filter((c) => c.soundId === RAIN.id),
    ).toHaveLength(1)
  })

  it('writes a staged_entries row with size + last-accessed, and a re-audition bumps last-accessed only', async () => {
    const { core, gateway, dbPath } = await signedInCore()
    await core.search('rain')

    core.stageOnAudition(RAIN.id)
    await waitUntil(() => core.getStagingStatus([RAIN.id])[RAIN.id] === 'ready')

    interface StagedRow {
      byte_size: number
      last_access_at: number
      created_at: number
      path: string
    }
    const db = openTempDb(dbPath)
    const row1 = getRow<StagedRow>(
      db,
      'staged_entries',
      'sound_id = ?',
      RAIN.id,
    )!
    expect(row1.byte_size).toBe(originalBytes(RAIN.id).length)
    expect(row1.path).toContain(`${RAIN.id}.${RAIN.ext}`)
    expect(row1.created_at).toBeGreaterThan(0)
    expect(row1.last_access_at).toBeGreaterThan(0)
    const callsAfterFirst = gateway.downloadCallCount

    await sleep(8)
    core.stageOnAudition(RAIN.id)

    const row2 = getRow<StagedRow>(
      db,
      'staged_entries',
      'sound_id = ?',
      RAIN.id,
    )!
    expect(row2.last_access_at).toBeGreaterThan(row1.last_access_at)
    expect(row2.created_at).toBe(row1.created_at)
    expect(gateway.downloadCallCount).toBe(callsAfterFirst)
  })

  it('moving past a Sound quickly cancels its in-flight download', async () => {
    const { core } = await signedInCore({
      gateway: makeFakeGateway({ downloadDelayMs: 200 }),
    })
    await core.search('rain')

    core.stageOnAudition(RAIN.id)
    await waitUntil(
      () => core.getStagingStatus([RAIN.id])[RAIN.id] === 'downloading',
    )

    core.stageOnAudition(DRIZZLE.id)
    expect(core.getStagingStatus([RAIN.id])[RAIN.id]).toBe('not-started')

    await sleep(60)
    expect(core.getStagingStatus([RAIN.id])[RAIN.id]).toBe('not-started')
    expect(['queued', 'downloading', 'ready']).toContain(
      core.getStagingStatus([DRIZZLE.id])[DRIZZLE.id],
    )
  })

  it('skimming a list does not leave a download per row running or queued', async () => {
    const { core, gateway, dataDir } = await signedInCore({
      gateway: makeFakeGateway({ downloadDelayMs: 120 }),
    })
    await core.search('loops', { page: 1, pageSize: 3 })
    await core.search('loops', { page: 2, pageSize: 3 })

    for (const id of LOOP_IDS) core.stageOnAudition(id)

    const nowStatuses = core.getStagingStatus(LOOP_IDS)
    const live = LOOP_IDS.filter((id) =>
      ['queued', 'downloading'].includes(nowStatuses[id] as string),
    )
    expect(live.length).toBeLessThanOrEqual(1)
    expect(gateway.downloadMaxConcurrent).toBeLessThanOrEqual(
      DOWNLOAD_CONCURRENCY,
    )

    await waitUntil(
      () =>
        LOOP_IDS.every((id) =>
          ['not-started', 'ready'].includes(
            core.getStagingStatus([id])[id] as string,
          ),
        ),
      5000,
    )
    const ready = LOOP_IDS.filter(
      (id) => core.getStagingStatus([id])[id] === 'ready',
    )
    expect(ready).toEqual([500006])
    expect(gateway.downloadCallCount).toBeLessThan(LOOP_IDS.length)
    expect(listContent(dataDir).filter((f) => f.endsWith('.flac'))).toEqual([
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

    expect(gateway.refreshCalls).toHaveLength(1)
    expect(
      gateway.downloadCalls.filter((c) => c.soundId === RAIN.id),
    ).toHaveLength(2)
    expect(readFileSync(originalPath(dataDir, RAIN), 'utf8')).toBe(
      originalBytes(RAIN.id),
    )
  })
})

describe('staging gates', () => {
  it('does not stage anything while signed out (auditioning still works)', async () => {
    const { core, gateway, dataDir, dbPath } = await signedInCore()

    const result = await core.search('rain')
    expect(result.sounds.length).toBeGreaterThan(0)
    await core.signOut()

    core.stageOnAudition(RAIN.id)
    await sleep(60)

    expect(gateway.downloadCallCount).toBe(0)
    expect(core.getStagingStatus([RAIN.id])[RAIN.id]).toBe('not-started')
    expect(() => listContent(dataDir)).toThrow()

    expect(countRows(openTempDb(dbPath), 'staged_entries')).toBe(0)
  })

  it('does not stage before consent is granted; stages after grantStagingConsent()', async () => {
    const { core, gateway, dataDir } = await signedInCore(
      {},
      { consent: false },
    )
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
    expect(readFileSync(originalPath(dataDir, RAIN), 'utf8')).toBe(
      originalBytes(RAIN.id),
    )
  })

  it('grantStagingConsent is idempotent and persists across a reopen', async () => {
    const { core, dbPath } = await signedInCore({}, { consent: false })
    const first = core.grantStagingConsent().grantedAt
    await sleep(5)
    const second = core.grantStagingConsent().grantedAt
    expect(second).toBe(first)

    const db = openTempDb(dbPath)
    expect(
      getRow<{ value: string }>(db, 'app_meta', "key = 'staging_consent_at'")!
        .value,
    ).toBe(String(first))
  })
})

describe('core.downloadToLibrary', () => {
  it('downloads the Original, saves it to the Library (no staged row) and logs the download', async () => {
    const { core, dataDir, dbPath } = await signedInCore()
    await core.search('rain')

    core.downloadToLibrary(RAIN.id)
    await waitUntil(() => core.getStagingStatus([RAIN.id])[RAIN.id] === 'ready')

    expect(readFileSync(originalPath(dataDir, RAIN), 'utf8')).toBe(
      originalBytes(RAIN.id),
    )

    expect(core.getLibraryMembership([RAIN.id])[RAIN.id]).toBe(true)
    expect(countRows(openTempDb(dbPath), 'staged_entries')).toBe(0)

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
    const { core } = await signedInCore({}, { consent: false })
    await core.search('rain')
    await core.signOut()

    core.downloadToLibrary(RAIN.id)
    await sleep(30)

    expect(core.getStagingStatus([RAIN.id])[RAIN.id]).toBe('not-started')
    expect(core.getLibraryMembership([RAIN.id])[RAIN.id]).toBe(false)
    expect(core.getDownloadsInLast24h()).toBe(0)
  })

  it('getDownloadsInLast24h counts only the trailing 24 h', async () => {
    const { core, dbPath } = await signedInCore()
    const db = openTempDb(dbPath)
    const now = Date.now()
    const insert = db.prepare(
      'INSERT INTO download_log (sound_id, downloaded_at) VALUES (?, ?)',
    )
    insert.run(1, now - 2 * 60 * 60 * 1000)
    insert.run(2, now - 25 * 60 * 60 * 1000)
    expect(core.getDownloadsInLast24h()).toBe(1)
  })
})
