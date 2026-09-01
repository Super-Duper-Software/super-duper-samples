// The always-visible auditioning controls (ticket 04): volume (in-app, applied
// to the shared HTMLAudioElement, independent of system volume, persisted),
// loop, and auto-advance. It subscribes to `useTransport` for these coarse
// prefs only — it is not on the list's render path, so re-rendering it when the
// volume slider moves costs nothing.
//
// Ticket 06 (spec 0003) — in the rail layout this collapses to a single row:
// play/pause · current-sound name (truncate) · `♥` glyph · a `⋯` sub-panel
// holding Stop, Loop, Auto-advance and the volume slider. The scrub waveform
// stays above it at `h-12` (down from `h-16`), and the fixed-width status-label
// column is replaced by a colour/pulse cue on the play button. The wide layout
// is unchanged.

import { useEffect, useRef, useState } from 'react'
import { useViewport } from '../lib/viewport'
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
  const { isRail } = useViewport()
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
            className={`${isRail ? 'h-12' : 'h-16'} w-full rounded bg-bg-inset`}
          />
        </div>
      )}

      {isRail ? (
        <div className="flex items-center gap-x-3 px-4 py-2 text-xs text-ink-muted">
          <button
            type="button"
            onClick={toggle}
            disabled={!hasSound}
            className={[
              'grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] enabled:hover:border-line-strong disabled:opacity-40',
              status === 'loading'
                ? 'animate-pulse border-accent-2 text-accent-2-text'
                : status === 'playing'
                  ? 'border-accent-2 text-accent-2-text'
                  : 'border-line',
            ].join(' ')}
            aria-label={status === 'playing' ? 'Pause' : 'Play'}
            title={statusLabel(status, hasSound)}
          >
            {status === 'playing' ? '❚❚' : '▶'}
          </button>

          <span
            className="min-w-0 flex-1 truncate"
            title={currentSound?.name ?? statusLabel(status, hasSound)}
          >
            {currentSound?.name ?? statusLabel(status, hasSound)}
          </span>

          {/*
            Always-present way to support the app — glyph only in rail; the
            tooltip is kept. Opens ko-fi.com/sparlos in the user's browser.
          */}
          <button
            type="button"
            onClick={() => void window.core.openSupportPage()}
            title="Support this app on Ko-fi"
            aria-label="Support this app on Ko-fi"
            className="shrink-0 rounded border border-accent-2 px-2 py-1 text-accent-2-text hover:bg-surface-raised"
          >
            <span aria-hidden>♥</span>
          </button>

          <RailTransportMenu
            hasSound={hasSound}
            stop={stop}
            loop={loop}
            setLoop={setLoop}
            autoAdvance={autoAdvance}
            setAutoAdvance={setAutoAdvance}
            volume={volume}
            setVolume={setVolume}
          />
        </div>
      ) : (
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
      )}
    </div>
  )
}

/**
 * The rail transport `⋯` — a small upward-opening sub-panel (spec 0003 allows
 * "a small always-open sub-panel" for the volume slider, which `OverflowMenu`
 * cannot host). Closes on Escape / outside click; every control inside is a
 * native element so Tab / arrows / Space reach all of it.
 */
function RailTransportMenu({
  hasSound,
  stop,
  loop,
  setLoop,
  autoAdvance,
  setAutoAdvance,
  volume,
  setVolume,
}: {
  hasSound: boolean
  stop: () => void
  loop: boolean
  setLoop: (v: boolean) => void
  autoAdvance: boolean
  setAutoAdvance: (v: boolean) => void
  volume: number
  setVolume: (v: number) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="More playback controls"
        title="More playback controls"
        className="inline-flex items-center justify-center rounded border border-line px-1.5 py-0.5 text-[13px] leading-none text-ink-muted hover:border-line-strong hover:text-ink"
      >
        <span aria-hidden>⋯</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Playback controls"
          className="absolute bottom-full right-0 z-30 mb-1 w-52 rounded border border-line bg-surface p-2 text-xs text-ink shadow-xl"
        >
          <button
            type="button"
            onClick={() => {
              stop()
              setOpen(false)
            }}
            disabled={!hasSound}
            className="mb-2 w-full rounded border border-line px-2 py-1 text-left enabled:hover:border-line-strong disabled:opacity-40"
          >
            Stop
          </button>

          <label className="mb-2 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
              className="accent-[var(--sd-accent-2)]"
            />
            Loop
          </label>

          <label className="mb-2 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.checked)}
              className="accent-[var(--sd-accent-2)]"
            />
            Auto-advance
          </label>

          <label className="flex items-center gap-2">
            <span className="text-ink-faint">Vol</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="h-1 flex-1 accent-[var(--sd-accent-2)]"
              aria-label="Audition volume"
            />
            <span className="w-8 tabular-nums text-ink-faint">
              {Math.round(volume * 100)}
            </span>
          </label>
        </div>
      )}
    </div>
  )
}
