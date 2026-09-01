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
    <div className="shrink-0 border-t border-line bg-bg">
      {currentSound && (
        <div className="border-b border-line px-4 pt-2">
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
            className="h-16 w-full rounded bg-bg-inset"
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-xs text-ink-muted">
        <button
          type="button"
          onClick={toggle}
          disabled={!hasSound}
          className="grid h-7 w-7 place-items-center rounded-full border border-line text-[11px] enabled:hover:border-line-strong disabled:opacity-40"
          aria-label={status === 'playing' ? 'Pause' : 'Play'}
        >
          {status === 'playing' ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!hasSound}
          className="rounded border border-line px-2 py-1 enabled:hover:border-line-strong disabled:opacity-40"
        >
          Stop
        </button>

        <span className="w-28 shrink-0 tabular-nums text-ink-faint">
          {statusLabel(status, hasSound)}
        </span>

        <label className="flex items-center gap-2">
          <span className="text-ink-faint">Vol</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="h-1 w-28 accent-[var(--sd-accent-2)]"
            aria-label="Audition volume"
          />
          <span className="w-8 tabular-nums text-ink-faint">
            {Math.round(volume * 100)}
          </span>
        </label>

        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
            className="accent-[var(--sd-accent-2)]"
          />
          Loop
        </label>

        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(e) => setAutoAdvance(e.target.checked)}
            className="accent-[var(--sd-accent-2)]"
          />
          Auto-advance
        </label>

        {/*
          Always-present way to support the app — the startup splash can be
          dismissed for good, this cannot. Opens ko-fi.com/sparlos in the
          user's browser (no Ko-fi code in the renderer; CSP untouched).
        */}
        <button
          type="button"
          onClick={() => void window.core.openSupportPage()}
          title="Support this app on Ko-fi"
          className="ml-auto rounded border border-accent-2 px-2 py-1 text-accent-2-text hover:bg-surface-raised"
        >
          <span aria-hidden>♥</span> Support
        </button>
      </div>
    </div>
  )
}
