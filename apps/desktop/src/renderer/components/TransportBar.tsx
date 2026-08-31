// The always-visible auditioning controls (ticket 04): volume (in-app, applied
// to the shared HTMLAudioElement, independent of system volume, persisted),
// loop, and auto-advance. It subscribes to `useTransport` for these coarse
// prefs only — it is not on the list's render path, so re-rendering it when the
// volume slider moves costs nothing.

import { useTransport } from '../store/useTransport'
import { Waveform } from './Waveform'

function statusLabel(status: string, hasSound: boolean): string {
  if (!hasSound) return 'Nothing playing'
  switch (status) {
    case 'loading':
      return 'Buffering…'
    case 'playing':
      return 'Playing'
    case 'paused':
      return 'Paused'
    default:
      return 'Nothing playing'
  }
}

export function TransportBar() {
  const status = useTransport((s) => s.status)
  const currentSoundId = useTransport((s) => s.currentSoundId)
  const currentSound = useTransport((s) => s.currentSound)
  const volume = useTransport((s) => s.volume)
  const loop = useTransport((s) => s.loop)
  const autoAdvance = useTransport((s) => s.autoAdvance)
  const setVolume = useTransport((s) => s.setVolume)
  const setLoop = useTransport((s) => s.setLoop)
  const setAutoAdvance = useTransport((s) => s.setAutoAdvance)
  const toggle = useTransport((s) => s.toggle)
  const stop = useTransport((s) => s.stop)

  const hasSound = currentSoundId != null

  return (
    <div className="shrink-0 border-t border-neutral-800 bg-neutral-950">
      {currentSound && (
        <div className="border-b border-neutral-900 px-4 pt-2">
          {/*
            Ticket 12: the full, zoomable, scrubbable waveform for the sound being
            auditioned. Draws from computed peaks once the Original is on disk and
            decoded; until then it shows the Freesound waveform image, upgrading
            in place with no layout shift. Wheel to zoom, double-click to reset,
            click / drag to seek (accurate while zoomed).
          */}
          <Waveform
            key={currentSound.id}
            soundId={currentSound.id}
            url={currentSound.waveformUrls.m}
            active
            className="h-16 w-full rounded bg-neutral-900/40"
          />
        </div>
      )}
      <div className="flex items-center gap-4 px-4 py-2 text-xs text-neutral-300">
        <button
          type="button"
          onClick={toggle}
          disabled={!hasSound}
          className="grid h-7 w-7 place-items-center rounded-full border border-neutral-700 text-[11px] enabled:hover:border-neutral-500 disabled:opacity-40"
          aria-label={status === 'playing' ? 'Pause' : 'Play'}
        >
          {status === 'playing' ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!hasSound}
          className="rounded border border-neutral-700 px-2 py-1 enabled:hover:border-neutral-500 disabled:opacity-40"
        >
          Stop
        </button>

        <span className="w-28 shrink-0 tabular-nums text-neutral-500">
          {statusLabel(status, hasSound)}
        </span>

        <label className="flex items-center gap-2">
          <span className="text-neutral-500">Vol</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="h-1 w-28 accent-emerald-500"
            aria-label="Audition volume"
          />
          <span className="w-8 tabular-nums text-neutral-500">
            {Math.round(volume * 100)}
          </span>
        </label>

        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
            className="accent-emerald-500"
          />
          Loop
        </label>

        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(e) => setAutoAdvance(e.target.checked)}
            className="accent-emerald-500"
          />
          Auto-advance
        </label>
      </div>
    </div>
  )
}
