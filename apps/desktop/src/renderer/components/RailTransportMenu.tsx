import { useEffect, useRef, useState } from 'react'

export interface RailTransportMenuProps {
  hasSound: boolean
  stop: () => void
  loop: boolean
  setLoop: (v: boolean) => void
  autoAdvance: boolean
  setAutoAdvance: (v: boolean) => void
  volume: number
  setVolume: (v: number) => void
}

/**
 * The rail transport `⋯`: a small upward-opening sub-panel, which `OverflowMenu`
 * cannot host because of the volume slider. Every control inside is a native
 * element, so Tab / arrows / Space reach all of it.
 */
export function RailTransportMenu({
  hasSound,
  stop,
  loop,
  setLoop,
  autoAdvance,
  setAutoAdvance,
  volume,
  setVolume,
}: RailTransportMenuProps) {
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
