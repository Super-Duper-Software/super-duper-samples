import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { LibrarySound, Sound } from '../../core/types'
import { selectPeaks, usePeaks } from '../store/usePeaks'
import { ExportDialog } from './ExportDialog'
import { EditWaveform } from './edit/EditWaveform'
import { useContentPath } from './edit/useContentPath'
import { useRegionAudition } from './edit/useRegionAudition'
import { useWaveformGestures } from './edit/useWaveformGestures'
import { regionToSeconds } from '../lib/regionGeometry'
import { formatPreciseDuration } from '../lib/format'
import { waveformDisplayState } from '../lib/editViewState'

export interface EditViewProps {
  sound: Sound
  onClose: () => void
}

const UNAVAILABLE_NOTE =
  "A waveform isn't available for this file. You can still select a region against the time readout and export it — if the export fails, pick a different format in the export dialog."

export function EditView({ sound, onClose }: EditViewProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [showExport, setShowExport] = useState(false)

  const displayName = (sound as Partial<LibrarySound>).customName ?? sound.name

  const peaks = usePeaks(useShallow(selectPeaks(sound.id)))
  const ensurePeaks = usePeaks((s) => s.ensure)
  useEffect(() => {
    ensurePeaks(sound.id)
  }, [sound.id, ensurePeaks])

  const contentPath = useContentPath(sound.id)
  const wfState = waveformDisplayState(peaks, contentPath)
  const hasPeaks = wfState === 'ready'

  const gestures = useWaveformGestures(boxRef, {
    zoomEnabled: hasPeaks,
    regionEnabled: wfState === 'ready' || wfState === 'unavailable',
  })
  const { region } = gestures

  const loop = useRegionAudition(contentPath, sound.duration, region)

  const clearRegion = useCallback(() => {
    gestures.setRegion(null)
    loop.stop()
  }, [gestures, loop])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing =
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      if (typing || showExport) return
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        loop.toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, loop, showExport])

  const rSec = region ? regionToSeconds(region, sound.duration) : null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-ink">
      <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">
            Edit — {displayName}
          </h2>
          <p className="text-xs text-ink-faint">
            {formatPreciseDuration(sound.duration)} total · scroll to zoom,
            scroll sideways (or Shift+scroll) to pan, double-click to reset ·
            drag to select a region ·{' '}
            <kbd className="rounded border border-line px-1">Space</kbd>{' '}
            loops/stops the region ·{' '}
            <kbd className="rounded border border-line px-1">Esc</kbd> closes
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Edit view"
          title="Close (Esc) — nothing is saved here"
          className="rounded border border-line px-2 py-1 text-sm text-ink-muted hover:border-line-strong hover:text-ink"
        >
          ✕
        </button>
      </header>

      <section className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        {wfState === 'no-original' && (
          <p className="rounded border border-warn p-3 text-sm text-warn">
            This Sound's Original is not on disk. Download it to your Library
            first, then reopen the Edit view.
          </p>
        )}

        {(wfState === 'computing' || wfState === 'unavailable') && (
          <p
            className={
              wfState === 'unavailable'
                ? 'rounded border border-warn p-3 text-sm text-warn'
                : 'text-sm text-ink-muted'
            }
            aria-live="polite"
          >
            {wfState === 'unavailable'
              ? UNAVAILABLE_NOTE
              : 'Computing the waveform…'}
          </p>
        )}

        <EditWaveform
          boxRef={boxRef}
          peaks={peaks}
          hasPeaks={hasPeaks}
          gestures={gestures}
        />

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="tabular-nums text-ink-muted">
            Start: {rSec ? formatPreciseDuration(rSec.startSec) : '—'}
          </span>
          <span className="tabular-nums text-ink-muted">
            End: {rSec ? formatPreciseDuration(rSec.endSec) : '—'}
          </span>
          <span className="tabular-nums text-ink-muted">
            Duration: {rSec ? formatPreciseDuration(rSec.durationSec) : '—'}
          </span>

          <button
            type="button"
            onClick={clearRegion}
            disabled={!region}
            className="rounded border border-line px-2 py-1 text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            Clear region
          </button>

          <button
            type="button"
            onClick={loop.toggle}
            disabled={!region || !contentPath}
            className={[
              'rounded border px-2 py-1 disabled:opacity-40',
              loop.playing
                ? 'border-accent-2 text-accent-2-text'
                : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
            ].join(' ')}
            title="Loop-audition the selected region, playing the local Original (Space)"
          >
            {loop.playing ? '❚❚ Stop loop' : '▶ Loop region'}
          </button>

          <button
            type="button"
            onClick={() => setShowExport(true)}
            disabled={!contentPath}
            className="ml-auto rounded border border-accent bg-accent px-3 py-1 text-accent-on hover:bg-accent-hover disabled:opacity-40"
          >
            Export…
          </button>
        </div>
      </section>

      {showExport && (
        <ExportDialog
          sound={sound}
          sourceName={displayName}
          region={region}
          onClose={() => setShowExport(false)}
          onExported={onClose}
        />
      )}
    </div>
  )
}
