// Ticket 17 — Attribution Manifest, at the core seam. No Electron: real temp
// SQLite, real temp filesystem, a dead gateway (every method rejects) so the
// "generated entirely from the database" guarantee is proven.
//
// Covers the ticket's "Tests cover:" line:
//   - a Manifest lists every Collection member with author, License and URL
//   - attribution-required Sounds are separated from CC0
//   - non-commercial Sounds are flagged (and listed apart)
//   - the Manifest does not change when the Collection changes afterwards
//   - an empty Collection is handled with a message, not a blank document
// plus the pure `buildManifest` text renderer and the `obligations` predicates.

import { writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { writeOriginal } from '../src/core/staging/contentStore'
import { buildManifest } from '../src/core/manifest/buildManifest'
import {
  requiresAttribution,
  restrictsCommercialUse,
} from '../src/core/manifest/obligations'
import type { FreesoundGateway } from '../src/core/gateway/index'
import type { Sound } from '../src/core/types'
import type { AudioRenderRunner, EditSpec } from '../src/core'
import { makeTestCore } from './helpers/makeTestCore'

const WHOLE_FILE_SPEC: EditSpec = { trim: null, format: 'wav' }

/** A fast, deterministic fake `audioRenderRunner` — copies fixed bytes to `outPath`. */
function fakeRunner(bytes = 'FAKE-EDIT-BYTES'): AudioRenderRunner {
  return async ({ outPath }) => {
    await writeFile(outPath, bytes)
    return { byteSize: Buffer.byteLength(bytes), durationSec: 3 }
  }
}

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

function deadGateway(): FreesoundGateway {
  const fail = (): Promise<never> =>
    Promise.reject(new Error('gateway unavailable (offline)'))
  return {
    search: fail,
    getPreviewStream: fail,
    downloadOriginal: fail,
    exchangeToken: fail,
    refreshToken: fail,
    getMe: fail,
  } as unknown as FreesoundGateway
}

const LICENSES = {
  cc0: {
    url: 'http://creativecommons.org/publicdomain/zero/1.0/',
    name: 'CC0',
  },
  by: { url: 'http://creativecommons.org/licenses/by/4.0/', name: 'CC-BY' },
  byNc: {
    url: 'http://creativecommons.org/licenses/by-nc/4.0/',
    name: 'CC-BY-NC',
  },
} as const

function fakeSound(id: number, over: Partial<Sound> = {}): Sound {
  return {
    id,
    name: `sound ${id}`,
    username: `author${id}`,
    license: LICENSES.cc0,
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

/** A core with no network and the given Sounds seeded on disk + in the Library. */
async function offlineCoreWithLibrary(
  sounds: Sound[],
  opts: { audioRenderRunner?: AudioRenderRunner } = {},
) {
  const tc = await makeTestCore({
    gateway: deadGateway(),
    audioRenderRunner: opts.audioRenderRunner,
  })
  cleanups.push(() => {
    try {
      tc.core.close()
    } catch {
      /* already closed */
    }
  })
  for (const s of sounds) {
    await writeOriginal(
      tc.dataDir,
      s,
      new TextEncoder().encode(`BYTES-${s.id}`),
      Date.now(),
    )
    tc.core.saveToLibrary(s.id, s)
  }
  return tc
}

// ───────────────────────── obligations ──────────────────────────

describe('license obligations', () => {
  it('requires attribution for everything except CC0', () => {
    expect(requiresAttribution('CC0')).toBe(false)
    expect(requiresAttribution('CC-BY')).toBe(true)
    expect(requiresAttribution('CC-BY-NC')).toBe(true)
    expect(requiresAttribution('CC-BY-SA')).toBe(true)
    expect(requiresAttribution('Sampling+')).toBe(true)
    // unrecognised label (still a raw URL) — treated conservatively
    expect(requiresAttribution('http://example.com/some-license')).toBe(true)
  })

  it('flags the NonCommercial family (and anything unrecognised) as commercial-restricted', () => {
    expect(restrictsCommercialUse('CC0')).toBe(false)
    expect(restrictsCommercialUse('CC-BY')).toBe(false)
    expect(restrictsCommercialUse('CC-BY-SA')).toBe(false)
    expect(restrictsCommercialUse('CC-BY-ND')).toBe(false)
    expect(restrictsCommercialUse('CC-BY-NC')).toBe(true)
    expect(restrictsCommercialUse('CC-BY-NC-SA')).toBe(true)
    expect(restrictsCommercialUse('CC-BY-NC-ND')).toBe(true)
    expect(restrictsCommercialUse('http://example.com/some-license')).toBe(true)
  })
})

// ───────────────────────── pure buildManifest ──────────────────────────

describe('buildManifest (pure text renderer)', () => {
  it('is just the credit lines — no document title, no "generated" date, no prose', () => {
    const m = buildManifest({
      collectionId: 1,
      collectionName: 'Ferry Ad',
      generatedAt: Date.parse('2026-08-30T12:00:00Z'),
      sounds: [
        fakeSound(10, { name: 'Rain on tin', username: 'fieldrec', license: LICENSES.by }),
      ],
    })

    expect(m.text).toBe(
      '"Rain on tin" by fieldrec — CC-BY\nhttps://freesound.org/s/10/',
    )
    // none of the removed chrome
    expect(m.text).not.toMatch(/manifest/i)
    expect(m.text).not.toMatch(/generated/i)
    expect(m.text).not.toMatch(/this project uses/i)
    expect(m.text).not.toMatch(/credit each/i)
    expect(m.text).not.toContain('Ferry Ad') // the collection name is not in the payload
  })

  it('lists every Sound with title, author, License name and Freesound URL', () => {
    const m = buildManifest({
      collectionId: 1,
      collectionName: 'Ferry Ad',
      generatedAt: Date.parse('2026-08-30T12:00:00Z'),
      sounds: [
        fakeSound(10, { name: 'Rain on tin', username: 'fieldrec', license: LICENSES.by }),
        fakeSound(11, { name: 'Room tone', username: 'quiet', license: LICENSES.cc0 }),
      ],
    })

    expect(m.entries).toHaveLength(2)
    expect(m.entries[0]).toMatchObject({
      soundId: 10,
      title: 'Rain on tin',
      author: 'fieldrec',
      licenseName: 'CC-BY',
      licenseUrl: LICENSES.by.url,
      freesoundUrl: 'https://freesound.org/s/10/',
      requiresAttribution: true,
      restrictsCommercialUse: false,
    })

    expect(m.text).toContain('"Rain on tin" by fieldrec — CC-BY')
    expect(m.text).toContain('https://freesound.org/s/10/')
    expect(m.text).toContain('"Room tone" by quiet — https://freesound.org/s/11/')
  })

  it('separates attribution-required Sounds from CC0', () => {
    const m = buildManifest({
      collectionId: 1,
      collectionName: 'Mix',
      generatedAt: Date.now(),
      sounds: [
        fakeSound(1, { name: 'Needs credit', license: LICENSES.by }),
        fakeSound(2, { license: LICENSES.cc0 }),
        fakeSound(3, { license: LICENSES.cc0 }),
      ],
    })

    expect(m.summary).toMatchObject({
      total: 3,
      attributionRequired: 1,
      noAttribution: 2,
      nonCommercial: 0,
    })
    const creditIdx = m.text.indexOf('"Needs credit" by')
    const cc0Idx = m.text.indexOf('CC0 (public domain, no attribution required):')
    expect(creditIdx).toBeGreaterThan(-1)
    expect(cc0Idx).toBeGreaterThan(creditIdx) // CC0 listed after, on its own
  })

  it('flags non-commercial Sounds inline and lists them apart', () => {
    const m = buildManifest({
      collectionId: 1,
      collectionName: 'Paid job',
      generatedAt: Date.now(),
      sounds: [
        fakeSound(1, { name: 'Thunder', username: 'sky', license: LICENSES.byNc }),
        fakeSound(2, { license: LICENSES.by }),
      ],
    })

    expect(m.summary.nonCommercial).toBe(1)
    // inline flag in the credit line
    expect(m.text).toContain(
      '"Thunder" by sky — CC-BY-NC (non-commercial use only)',
    )
    // and a dedicated block, after the ordinary credits
    const ncIdx = m.text.indexOf(
      'Non-commercial licenses — not cleared for commercial use:',
    )
    const creditIdx = m.text.indexOf('"Thunder" by sky — CC-BY-NC (non-commercial')
    expect(ncIdx).toBeGreaterThan(creditIdx)
    expect(m.text).toContain(
      '"Thunder" by sky — CC-BY-NC — https://freesound.org/s/1/',
    )
  })

  it('handles an empty Collection with a message, not a blank document', () => {
    const m = buildManifest({
      collectionId: 1,
      collectionName: 'Nothing yet',
      generatedAt: Date.parse('2026-08-30T00:00:00Z'),
      sounds: [],
    })
    expect(m.entries).toEqual([])
    expect(m.summary.total).toBe(0)
    expect(m.text).toMatch(/nothing to attribute/i)
  })
})

// ───────────────────────── core.generateManifest ──────────────────────────

describe('core.generateManifest', () => {
  it('lists every Collection member with author, License and URL — no gateway call', async () => {
    const { core } = await offlineCoreWithLibrary([
      fakeSound(1, { name: 'A', username: 'anna', license: LICENSES.by }),
      fakeSound(2, { name: 'B', username: 'ben', license: LICENSES.cc0 }),
    ])
    const c = core.createCollection('Client — Ferry Ad')
    core.addToCollection(c.id, [1, 2])

    const m = core.generateManifest(c.id)

    expect(m.collectionName).toBe('Client — Ferry Ad')
    expect(m.entries.map((e) => e.soundId).sort()).toEqual([1, 2])
    for (const e of m.entries) {
      expect(e.author).toBeTruthy()
      expect(e.licenseName).toBeTruthy()
      expect(e.licenseUrl).toMatch(/^https?:\/\//)
      expect(e.freesoundUrl).toContain('/freesound.org/s/')
    }
  })

  it('throws for an unknown Collection', async () => {
    const { core } = await offlineCoreWithLibrary([])
    expect(() => core.generateManifest(4242)).toThrow(/no collection/i)
  })

  it('is a snapshot — it does not change when the Collection changes afterwards', async () => {
    const { core } = await offlineCoreWithLibrary([
      fakeSound(1, { license: LICENSES.by }),
      fakeSound(2, { license: LICENSES.by }),
      fakeSound(3, { license: LICENSES.by }),
    ])
    const c = core.createCollection('Snapshot me')
    core.addToCollection(c.id, [1, 2])

    const first = core.generateManifest(c.id)
    const firstText = first.text
    expect(first.summary.total).toBe(2)

    // mutate the Collection every which way
    core.addToCollection(c.id, [3])
    core.removeFromCollection(c.id, 1)
    core.renameCollection(c.id, 'Totally different name')

    // the value we already hold is untouched
    expect(first.text).toBe(firstText)
    expect(first.summary.total).toBe(2)
    expect(first.collectionName).toBe('Snapshot me')

    // a fresh call reflects the new reality — proving the first was a snapshot
    const second = core.generateManifest(c.id)
    expect(second.summary.total).toBe(2) // added 3, removed 1
    expect(second.entries.map((e) => e.soundId).sort()).toEqual([2, 3])
    expect(second.collectionName).toBe('Totally different name')
    expect(second.text).not.toBe(firstText)
  })

  it('separates CC0 from attribution-required and flags non-commercial members', async () => {
    const { core } = await offlineCoreWithLibrary([
      fakeSound(1, { license: LICENSES.by }),
      fakeSound(2, { license: LICENSES.cc0 }),
      fakeSound(3, { license: LICENSES.byNc }),
    ])
    const c = core.createCollection('Everything')
    core.addToCollection(c.id, [1, 2, 3])

    const m = core.generateManifest(c.id)
    expect(m.summary).toMatchObject({
      total: 3,
      attributionRequired: 2,
      noAttribution: 1,
      nonCommercial: 1,
    })
    expect(m.text).toMatch(/non-commercial/i)
    expect(m.text).toContain('CC0 (public domain, no attribution required):')
  })

  it('generates a clear message for an empty Collection', async () => {
    const { core } = await offlineCoreWithLibrary([])
    const c = core.createCollection('Empty')
    const m = core.generateManifest(c.id)
    expect(m.entries).toEqual([])
    expect(m.text).toMatch(/nothing to attribute/i)
  })
})

// ───────────────────────── Edits in the Manifest (ticket 05) ──────────────────────────

describe('Edits in the Attribution Manifest (ticket 05)', () => {
  it("credits an Edit to its parent's author, License and URL, marked as edited", async () => {
    const { core } = await offlineCoreWithLibrary(
      [
        fakeSound(1, {
          name: 'Rain on tin',
          username: 'fieldrec',
          license: LICENSES.by,
        }),
      ],
      { audioRenderRunner: fakeRunner() },
    )
    const { editId } = (await core.createEdit(1, WHOLE_FILE_SPEC))!

    const c = core.createCollection('With an edit')
    core.addToCollection(c.id, [editId])
    const m = core.generateManifest(c.id)

    expect(m.entries).toHaveLength(1)
    expect(m.entries[0]).toMatchObject({
      soundId: editId,
      author: 'fieldrec',
      licenseName: 'CC-BY',
      licenseUrl: LICENSES.by.url,
      freesoundUrl: 'https://freesound.org/s/1/',
      isEdit: true,
    })
    expect(m.text).toContain('by fieldrec')
    expect(m.text).toContain('(edited)')
    expect(m.text).toContain('https://freesound.org/s/1/')
  })

  it("titles an Edit's entry with the PARENT's original name, not the Edit's own", async () => {
    const { core } = await offlineCoreWithLibrary(
      [fakeSound(1, { name: 'Rain on tin', username: 'fieldrec', license: LICENSES.by })],
      { audioRenderRunner: fakeRunner() },
    )
    const { editId } = (await core.createEdit(1, WHOLE_FILE_SPEC))!
    // An unrenamed Edit's own name is the bare `edited` / `edited (N)` fallback
    // (ticket 01) — attribution must not show that; it credits the original.
    core.setCustomName(editId, 'My cool edit')

    const c = core.createCollection('With an edit')
    core.addToCollection(c.id, [editId])
    const m = core.generateManifest(c.id)

    expect(m.entries[0]!.title).toBe('Rain on tin')
    expect(m.text).toContain('"Rain on tin" by fieldrec')
    expect(m.text).not.toContain('My cool edit')
  })

  it('flags and segregates an Edit of a CC-BY-NC Sound exactly like its parent', async () => {
    const { core } = await offlineCoreWithLibrary(
      [fakeSound(1, { name: 'Thunder', username: 'sky', license: LICENSES.byNc })],
      { audioRenderRunner: fakeRunner() },
    )
    const { editId } = (await core.createEdit(1, WHOLE_FILE_SPEC))!

    const c = core.createCollection('Paid job')
    core.addToCollection(c.id, [editId])
    const m = core.generateManifest(c.id)

    expect(m.summary.nonCommercial).toBe(1)
    expect(m.entries[0].restrictsCommercialUse).toBe(true)
    // the inline flag AND the "edited" marker both show up on the credit line
    expect(m.text).toContain('(non-commercial use only, edited)')
    // and the Edit is listed apart, in the dedicated NC block
    const ncIdx = m.text.indexOf(
      'Non-commercial licenses — not cleared for commercial use:',
    )
    expect(ncIdx).toBeGreaterThan(-1)
    const ncBlock = m.text.slice(ncIdx)
    expect(ncBlock).toContain('by sky (edited)')
  })

  it('remains an unchanged snapshot when the Edit is later renamed or removed', async () => {
    const { core } = await offlineCoreWithLibrary(
      [fakeSound(1, { name: 'Rain on tin', license: LICENSES.by })],
      { audioRenderRunner: fakeRunner() },
    )
    const { editId } = (await core.createEdit(1, WHOLE_FILE_SPEC))!
    const c = core.createCollection('Snapshot with an edit')
    core.addToCollection(c.id, [editId])

    const first = core.generateManifest(c.id)
    const firstText = first.text

    core.setCustomName(editId, 'Renamed edit')
    core.removeFromCollection(c.id, editId)

    expect(first.text).toBe(firstText)
    expect(first.entries).toHaveLength(1)
  })
})
