// Auditioning transport state — Zustand, and deliberately OUTSIDE the list's
// render path (spec 0001 § Auditioning: "playback state must live outside the
// list's render path").
//
// What lives here: coarse, low-frequency state only — which sound is current,
// whether it is playing/paused, and the persisted prefs (volume, loop,
// auto-advance). What does NOT live here: `currentTime` / the playhead. The
// 60fps playhead is written straight to a DOM node by `audioController`'s rAF
// loop and never touches this store, so a moving playhead re-renders zero rows.
//
// The real HTMLAudioElement and the rAF loop are the module-singleton in
// `audioController.ts`. Store actions call into it; it pushes only
// playing/paused/ended/error events back.

import { create } from 'zustand'
import type { Sound } from '../../core/types'
import * as audio from './audioController'

export type TransportStatus = 'idle' | 'loading' | 'playing' | 'paused'

const VOLUME_KEY = 'freesound.transport.volume'
const AUTOADVANCE_KEY = 'freesound.transport.autoAdvance'
const DEFAULT_VOLUME = 0.8

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback
  } catch {
    return fallback
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw == null ? fallback : raw === 'true'
  } catch {
    return fallback
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* renderer-only pref; fine to lose if storage is unavailable */
  }
}

/**
 * Pick the Preview URL to stream. Prefer the HQ mp3, fall back to the LQ mp3.
 *
 * This is a PREVIEW (CONTEXT.md § Preview): lossy, public, no auth, not a
 * download. It is auditioned only and is never persisted or made draggable —
 * see the audio-source boundary comment in `audioController.ts` and ADR-0003.
 */
function previewUrl(sound: Sound): string | null {
  return sound.previewUrls.hqMp3 || sound.previewUrls.lqMp3 || null
}

export interface TransportState {
  status: TransportStatus
  currentSoundId: number | null
  loop: boolean
  autoAdvance: boolean
  volume: number
  /** Sound ids whose Preview failed to load. Keyed by id, not carried on row props. */
  failedIds: Set<number>

  /** Auto-advance hook, registered by the result list (which owns the sound array). */
  _advance: (() => void) | null

  playSound: (sound: Sound) => void
  toggle: () => void
  stop: () => void
  seekFraction: (fraction: number) => void
  setVolume: (volume: number) => void
  setLoop: (loop: boolean) => void
  setAutoAdvance: (on: boolean) => void
  markFailed: (soundId: number) => void
  setAdvance: (fn: (() => void) | null) => void
}

export const useTransport = create<TransportState>((set, get) => ({
  status: 'idle',
  currentSoundId: null,
  loop: false,
  autoAdvance: readBool(AUTOADVANCE_KEY, false),
  volume: readNumber(VOLUME_KEY, DEFAULT_VOLUME),
  failedIds: new Set<number>(),
  _advance: null,

  playSound: (sound) => {
    const url = previewUrl(sound)
    if (!url) {
      get().markFailed(sound.id)
      return
    }
    // A fresh attempt clears any prior failure marker for this row.
    set((s) => {
      if (!s.failedIds.has(sound.id)) return { status: 'loading', currentSoundId: sound.id }
      const next = new Set(s.failedIds)
      next.delete(sound.id)
      return { status: 'loading', currentSoundId: sound.id, failedIds: next }
    })
    audio.load(sound.id, url, { loop: get().loop, volume: get().volume })
  },

  toggle: () => {
    const { status, currentSoundId } = get()
    if (currentSoundId == null) return
    if (status === 'playing') {
      audio.pause()
    } else {
      audio.resume()
    }
  },

  stop: () => {
    audio.stop()
    set({ status: 'idle', currentSoundId: null })
  },

  seekFraction: (fraction) => {
    audio.seekFraction(fraction)
  },

  setVolume: (volume) => {
    const v = Math.min(1, Math.max(0, volume))
    set({ volume: v })
    audio.setVolume(v)
    persist(VOLUME_KEY, String(v))
  },

  setLoop: (loop) => {
    set({ loop })
    audio.setLoop(loop)
  },

  setAutoAdvance: (on) => {
    set({ autoAdvance: on })
    persist(AUTOADVANCE_KEY, String(on))
  },

  markFailed: (soundId) => {
    set((s) => {
      const failedIds = new Set(s.failedIds)
      failedIds.add(soundId)
      const clearCurrent = s.currentSoundId === soundId
      return {
        failedIds,
        status: clearCurrent ? 'idle' : s.status,
        currentSoundId: clearCurrent ? null : s.currentSoundId,
      }
    })
  },

  setAdvance: (fn) => set({ _advance: fn }),
}))

// Wire the controller's coarse events into the store. Done once, at module load.
audio.setCallbacks({
  onLoading: () => useTransport.setState({ status: 'loading' }),
  onPlaying: () => useTransport.setState({ status: 'playing' }),
  onPaused: () =>
    useTransport.setState((s) => (s.status === 'playing' ? { status: 'paused' } : {})),
  onEnded: () => {
    const s = useTransport.getState()
    if (s.autoAdvance && s._advance) s._advance()
    else useTransport.setState({ status: 'paused' })
  },
  onError: (soundId) => useTransport.getState().markFailed(soundId),
})

// ─────────────────────────────────────────────────────────────────────────────
// Row selector.
//
// A row subscribes to ONLY these three booleans/enum via `useShallow`, so:
//   - a playhead frame changes nothing here            → 0 rows re-render
//   - starting a new track flips `isCurrent` for exactly the old and new rows
//                                                       → 2 rows re-render
//   - volume / loop / auto-advance changes are shallow-equal for every row
//                                                       → 0 rows re-render
// ─────────────────────────────────────────────────────────────────────────────
export interface RowTransport {
  isCurrent: boolean
  status: TransportStatus
  failed: boolean
}

export function selectRowTransport(soundId: number) {
  return (s: TransportState): RowTransport => ({
    isCurrent: s.currentSoundId === soundId,
    status: s.currentSoundId === soundId ? s.status : 'idle',
    failed: s.failedIds.has(soundId),
  })
}
