import type { Sound } from '../../src/core/types'

/** A Sound in the committed search fixtures, with what tests assert about it. */
export interface FixtureSound {
  readonly id: number
  readonly ext: string
  readonly author: string
  readonly license: string
  /** The duration the fixture reports — what a trim is clamped against. */
  readonly durationSec: number
}

/** `search-rain.json`, result 1 — the default subject of most staging tests. */
export const RAIN: FixtureSound = {
  id: 321967,
  ext: 'wav',
  author: 'klankbeeld',
  license: 'CC-BY',
  durationSec: 34.7208,
}

/** `search-rain.json`, result 2. */
export const DRIZZLE: FixtureSound = {
  id: 408535,
  ext: 'flac',
  author: 'InspectorJ',
  license: 'CC-BY-NC',
  durationSec: 12.004,
}

/** `search-rain.json`, result 3. */
export const THUNDER: FixtureSound = {
  id: 17185,
  ext: 'aiff',
  author: 'reinsamba',
  license: 'CC0',
  durationSec: 58.9,
}

/** `search-thunder.json`, result 2 — the only fixture Original that is an mp3. */
export const THUNDER_MP3: FixtureSound = {
  id: 233001,
  ext: 'mp3',
  author: 'kangaroovindaloo',
  license: 'CC-BY',
  durationSec: 21.33,
}

/** `search-loops-p1.json` + `search-loops-p2.json`, in page order. */
export const LOOP_IDS = [500001, 500002, 500003, 500004, 500005, 500006]

export const LICENSES = {
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

/** A complete, valid `Sound` for tests that need metadata rather than a fixture. */
export function fakeSound(id: number, over: Partial<Sound> = {}): Sound {
  return {
    id,
    name: `sound ${id}`,
    username: 'tester',
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
