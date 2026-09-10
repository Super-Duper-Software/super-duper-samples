import { create } from 'zustand'
import type { Sound } from '../../core/types'
import * as audio from './audioController'
import type { AudioErrorDetail } from './audioController'
import { toFileUrl } from './editAudioController'

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

/**
 * Why a Preview failed — the element-level cases from `audioController` plus the
 * local-Original fallback ones raised here in `playSound`.
 */
export type PreviewFailureDetail =
  | AudioErrorDetail
  | {
      trigger: 'no-content-path' | 'content-path-error'
      url: null
      reason?: string
    }

/**
 * Record a Preview failure to the app log (Help ▸ View Logs). Never throws:
 * diagnostics must not disturb playback, and `window` is absent in unit tests.
 */
function logPreviewFailure(
  soundId: number,
  detail?: PreviewFailureDetail,
): void {
  try {
    if (typeof window === 'undefined') return
    void window.core?.log?.('warn', 'preview failed', { soundId, ...detail })
  } catch {
    /* ignore */
  }
}

export interface TransportState {
  status: TransportStatus
  currentSoundId: number | null
  /**
   * The full Sound now loaded into the transport, for views that need more than
   * its id (the zoomable waveform in the transport bar). Coarse state: flips only
   * on a track change, never on a playhead frame.
   */
  currentSound: Sound | null
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
  markFailed: (soundId: number, detail?: PreviewFailureDetail) => void
  setAdvance: (fn: (() => void) | null) => void
}

export const useTransport = create<TransportState>((set, get) => ({
  status: 'idle',
  currentSoundId: null,
  currentSound: null,
  loop: false,
  autoAdvance: readBool(AUTOADVANCE_KEY, false),
  volume: readNumber(VOLUME_KEY, DEFAULT_VOLUME),
  failedIds: new Set<number>(),
  _advance: null,

  playSound: (sound) => {
    set((s) => {
      if (!s.failedIds.has(sound.id))
        return {
          status: 'loading',
          currentSoundId: sound.id,
          currentSound: sound,
        }
      const next = new Set(s.failedIds)
      next.delete(sound.id)
      return {
        status: 'loading',
        currentSoundId: sound.id,
        currentSound: sound,
        failedIds: next,
      }
    })

    const url = previewUrl(sound)
    if (url) {
      audio.load(sound.id, url, { loop: get().loop, volume: get().volume })
      return
    }

    try {
      void window.core
        ?.getContentPath?.(sound.id)
        ?.then((path) => {
          if (get().currentSoundId !== sound.id) return
          if (!path) {
            get().markFailed(sound.id, { trigger: 'no-content-path', url: null })
            return
          }
          audio.load(sound.id, toFileUrl(path), {
            loop: get().loop,
            volume: get().volume,
          })
        })
        ?.catch?.((err) =>
          get().markFailed(sound.id, {
            trigger: 'content-path-error',
            url: null,
            reason: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
          }),
        )
    } catch (err) {
      get().markFailed(sound.id, {
        trigger: 'content-path-error',
        url: null,
        reason: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      })
    }
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
    set({ status: 'idle', currentSoundId: null, currentSound: null })
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

  markFailed: (soundId, detail) => {
    logPreviewFailure(soundId, detail)
    set((s) => {
      const failedIds = new Set(s.failedIds)
      failedIds.add(soundId)
      const clearCurrent = s.currentSoundId === soundId
      return {
        failedIds,
        status: clearCurrent ? 'idle' : s.status,
        currentSoundId: clearCurrent ? null : s.currentSoundId,
        currentSound: clearCurrent ? null : s.currentSound,
      }
    })
  },

  setAdvance: (fn) => set({ _advance: fn }),
}))

audio.setCallbacks({
  onLoading: () => useTransport.setState({ status: 'loading' }),
  onPlaying: () => useTransport.setState({ status: 'playing' }),
  onPaused: () =>
    useTransport.setState((s) =>
      s.status === 'playing' ? { status: 'paused' } : {},
    ),
  onEnded: () => {
    const s = useTransport.getState()
    if (s.autoAdvance && s._advance) s._advance()
    else useTransport.setState({ status: 'paused' })
  },
  onError: (soundId, detail) =>
    useTransport.getState().markFailed(soundId, detail),
})

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
