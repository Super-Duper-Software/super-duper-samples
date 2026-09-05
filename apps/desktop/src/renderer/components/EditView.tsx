import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { LibrarySound, Sound } from '../../core/types'
import { selectPeaks, usePeaks } from '../store/usePeaks'
import * as editAudio from '../store/editAudioController'
import { ExportDialog } from './ExportDialog'
import {
  drawPeakWaveform,
  panWindow,
  pointerToFraction,
  zoomWindow,
} from '../lib/waveformPeaks'
import {
  hitTestEdge,
  moveRegionEdge,
  regionFromDrag,
  regionToSeconds,
  type Region,
} from '../lib/regionGeometry'
import { formatPreciseDuration } from '../lib/format'
import { waveformDisplayState } from '../lib/editViewState'

const FULL_WINDOW = { start: 0, end: 1 } as const
/** Pointer proximity to an edge that grabs it instead of starting a new region, in fraction-of-box units. */
const EDGE_HIT_FRACTION = 0.012

/** Per-event delta is clamped to ±this (px) before it drives zoom or pan. */
const MAX_WHEEL_STEP = 50
/** Zoom factor per clamped delta unit: e^(step * this). ~0.006 → a full flick ≈ 1.35×. */
const ZOOM_SENSITIVITY = 0.006
/** Fraction of the raw horizontal delta that becomes pan distance. */
const PAN_SENSITIVITY = 0.5
const GESTURE_LOCK_MS = 140

export interface EditViewProps {
  sound: Sound
  onClose: () => void
}

export function EditView({ sound, onClose }: EditViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)

  const displayName =
    (sound as Partial<LibrarySound>).customName ?? sound.name

  const peaks = usePeaks(useShallow(selectPeaks(sound.id)))
  const ensurePeaks = usePeaks((s) => s.ensure)
  useEffect(() => {
    ensurePeaks(sound.id)
  }, [sound.id, ensurePeaks])

  const [zoom, setZoom] = useState<{ start: number; end: number }>(FULL_WINDOW)
  const [region, setRegionState] = useState<Region | null>(null)
  const [contentPath, setContentPath] = useState<string | null | undefined>(
    undefined,
  )

  const wfState = waveformDisplayState(peaks, contentPath)
  const hasPeaks = wfState === 'ready'
  const canSelectRegion = wfState === 'ready' || wfState === 'unavailable'
  const [playing, setPlaying] = useState(false)
  const [showExport, setShowExport] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.core
      .getContentPath(sound.id)
      .then((p) => {
        if (!cancelled) setContentPath(p)
      })
      .catch(() => {
        if (!cancelled) setContentPath(null)
      })
    return () => {
      cancelled = true
    }
  }, [sound.id])

  useEffect(() => {
    editAudio.setCallbacks({ onEnded: () => setPlaying(false) })
    return () => {
      editAudio.stop()
      editAudio.setCallbacks({})
    }
  }, [])

  useEffect(() => {
    const node = playheadRef.current
    if (!node) return
    editAudio.registerPlayheadNode(node)
    return () => editAudio.unregisterPlayheadNode(node)
  }, [])

  useEffect(() => {
    const node = playheadRef.current
    if (!node) return
    node.style.setProperty('--pz0', String(zoom.start))
    node.style.setProperty(
      '--pspan',
      String(Math.max(zoom.end - zoom.start, 1e-6)),
    )
  }, [zoom])

  const toggleAudition = useCallback(() => {
    if (!contentPath || !region) return
    const { startSec, endSec } = regionToSeconds(region, sound.duration)
    if (playing) {
      editAudio.pause()
      setPlaying(false)
      return
    }
    editAudio.loadRegion(contentPath, { startSec, endSec })
    editAudio.play()
    setPlaying(true)
  }, [contentPath, region, playing, sound.duration])

  useEffect(() => {
    if (!playing || !region) return
    const { startSec, endSec } = regionToSeconds(region, sound.duration)
    editAudio.setRegion({ startSec, endSec })
  }, [region, playing, sound.duration])

  const clearRegion = useCallback(() => {
    setRegionState(null)
    if (playing) {
      editAudio.pause()
      setPlaying(false)
    }
  }, [playing])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing =
        !!el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      if (typing) return
      if (showExport) return
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        toggleAudition()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, toggleAudition, showExport])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks || peaks.bucketCount === 0) return
    const box = canvas.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) return
    drawPeakWaveform(
      canvas,
      { bucketCount: peaks.bucketCount, peaks: peaks.peaks },
      {
        width: box.width,
        height: box.height,
        dpr: window.devicePixelRatio || 1,
        windowStart: zoom.start,
        windowEnd: zoom.end,
        color: 'rgba(255, 90, 31, 0.9)',
        midColor: 'rgba(255, 90, 31, 0.3)',
      },
    )
  }, [peaks, zoom])

  useEffect(() => {
    if (!hasPeaks) return
    redraw()
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [hasPeaks, redraw])

  const gestureRef = useRef<{ axis: 'zoom' | 'pan'; until: number } | null>(null)
  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (!hasPeaks) return
      const el = boxRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return

      const now = e.timeStamp || performance.now()
      const held = gestureRef.current
      let axis: 'zoom' | 'pan'
      if (e.ctrlKey) axis = 'pan'
      else if (held && now < held.until) axis = held.axis
      else
        axis =
          e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 'pan' : 'zoom'
      gestureRef.current = { axis, until: now + GESTURE_LOCK_MS }

      const clamp = (n: number) =>
        Math.max(-MAX_WHEEL_STEP, Math.min(MAX_WHEEL_STEP, n))

      if (axis === 'pan') {
        const raw = e.deltaX !== 0 ? e.deltaX : e.deltaY
        const step = clamp(raw) * PAN_SENSITIVITY
        setZoom((z) => {
          const span = z.end - z.start
          const deltaFraction = (step / rect.width) * span
          return panWindow(z.start, z.end, deltaFraction)
        })
      } else {
        const focus = (e.clientX - rect.left) / rect.width
        const factor = Math.exp(clamp(e.deltaY) * ZOOM_SENSITIVITY)
        setZoom((z) => zoomWindow(z.start, z.end, factor, focus))
      }
    },
    [hasPeaks],
  )
  const resetZoom = useCallback(() => setZoom(FULL_WINDOW), [])

  const dragRef = useRef<
    | { kind: 'edge'; edge: 'start' | 'end' }
    | { kind: 'new'; anchor: number }
    | null
  >(null)

  const fractionAt = useCallback((clientX: number): number | null => {
    const el = boxRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return null
    const xFrac = (clientX - rect.left) / rect.width
    return pointerToFraction(xFrac, zoom.start, zoom.end)
  }, [zoom])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!canSelectRegion) return
      const frac = fractionAt(e.clientX)
      if (frac == null) return
      e.currentTarget.setPointerCapture?.(e.pointerId)

      const zoomSpan = Math.max(zoom.end - zoom.start, 1e-6)
      const hitRadius = EDGE_HIT_FRACTION * zoomSpan
      const edge = region ? hitTestEdge(region, frac, hitRadius) : null
      if (edge) {
        dragRef.current = { kind: 'edge', edge }
      } else {
        dragRef.current = { kind: 'new', anchor: frac }
        setRegionState(regionFromDrag(frac, frac))
      }
    },
    [canSelectRegion, fractionAt, zoom, region],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const frac = fractionAt(e.clientX)
      if (frac == null) return
      if (drag.kind === 'new') {
        setRegionState(regionFromDrag(drag.anchor, frac))
      } else {
        setRegionState((r) => (r ? moveRegionEdge(r, drag.edge, frac) : r))
      }
    },
    [fractionAt],
  )

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])

  const rSec = region ? regionToSeconds(region, sound.duration) : null

  const toBoxPct = (fileFraction: number): number => {
    const span = Math.max(zoom.end - zoom.start, 1e-6)
    return ((fileFraction - zoom.start) / span) * 100
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg text-ink">
      <header className="flex shrink-0 items-center justify-between border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Edit — {displayName}</h2>
          <p className="text-xs text-ink-faint">
            {formatPreciseDuration(sound.duration)} total · scroll to zoom,
            scroll sideways (or Shift+scroll) to pan, double-click to reset ·
            drag to select a region ·{' '}
            <kbd className="rounded border border-line px-1">Space</kbd>{' '}
            loops/stops the region · <kbd className="rounded border border-line px-1">Esc</kbd> closes
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
              ? "A waveform isn't available for this file. You can still select a region against the time readout and export it — if the export fails, pick a different format in the export dialog."
              : 'Computing the waveform…'}
          </p>
        )}

        <div
          ref={boxRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={resetZoom}
          onWheel={onWheel}
          className="relative min-h-0 flex-1 cursor-crosshair overflow-hidden rounded border border-line bg-surface"
        >
          {hasPeaks && (
            <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
          )}

          {region && (
            <>
              {/* Dim everything outside the region. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 bg-bg/70"
                style={{ width: `${Math.max(0, toBoxPct(region.start))}%` }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 bg-bg/70"
                style={{
                  width: `${Math.max(0, 100 - toBoxPct(region.end))}%`,
                }}
              />
              {/* Edge handles. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-[var(--sd-accent-2,#ff9d4d)]"
                style={{ left: `${toBoxPct(region.start)}%` }}
              />
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-0.5 bg-[var(--sd-accent-2,#ff9d4d)]"
                style={{ left: `${toBoxPct(region.end)}%` }}
              />
            </>
          )}

          <div ref={playheadRef} aria-hidden="true" className="waveform-playhead" />
        </div>

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
            onClick={toggleAudition}
            disabled={!region || !contentPath}
            className={[
              'rounded border px-2 py-1 disabled:opacity-40',
              playing
                ? 'border-accent-2 text-accent-2-text'
                : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
            ].join(' ')}
            title="Loop-audition the selected region, playing the local Original (Space)"
          >
            {playing ? '❚❚ Stop loop' : '▶ Loop region'}
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
