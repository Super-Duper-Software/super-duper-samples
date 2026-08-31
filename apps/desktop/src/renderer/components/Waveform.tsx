// The row / transport waveform.
//
// TWO render paths, chosen per Sound with NO layout shift between them:
//
//   1. No computed peaks (default, and always for a search result whose Original
//      is not downloaded): Freesound's pre-rendered waveform PNG, recoloured to
//      the app palette by masking a themed-colour element (ticket 03). Never an
//      <img>. An IntersectionObserver holds the mask back until near the
//      viewport; once shown, the id is remembered so scroll-back is instant.
//
//   2. Computed peaks present (ticket 12 — the Original is on disk and decoded):
//      a <canvas> drawn from the cached min/max envelope, sharp at any width and
//      devicePixelRatio, zoomable (wheel; double-click resets), and scrubbable
//      (click / drag) with the seek mapped through the zoom window so it stays
//      accurate while zoomed.
//
// The component asks `usePeaks.ensure()` on mount, so a Sound that gains real
// peaks while on screen upgrades from image to canvas in place — same box, same
// playhead node, no flicker.
//
// The playhead (ticket 04) is still a bare DOM node written at 60fps by
// `audioController` via the `--playhead` CSS var (0..1 of the whole file). This
// component additionally writes `--pz0` / `--pspan` (the zoom window) onto that
// node so its on-screen position is correct while zoomed — see index.css.

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  registerPlayheadNode,
  unregisterPlayheadNode,
} from '../store/audioController'
import { useTransport } from '../store/useTransport'
import { selectPeaks, usePeaks } from '../store/usePeaks'
import {
  drawPeakWaveform,
  pointerToFraction,
  zoomWindow,
} from '../lib/waveformPeaks'

/** Sound ids whose waveform image has been shown at least once this session. */
const shown = new Set<number>()

const FULL_WINDOW = { start: 0, end: 1 } as const

export interface WaveformProps {
  soundId: number
  /** `sound.waveformUrls.m` — the medium pre-rendered PNG (fallback path). */
  url: string
  /** True when this row is the sound currently being auditioned. */
  active?: boolean
  className?: string
}

export const Waveform = memo(function Waveform({
  soundId,
  url,
  active = false,
  className,
}: WaveformProps) {
  const ref = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const [masked, setMasked] = useState(() => shown.has(soundId))

  const peaks = usePeaks(useShallow(selectPeaks(soundId)))
  const ensurePeaks = usePeaks((s) => s.ensure)
  useEffect(() => {
    ensurePeaks(soundId)
  }, [soundId, ensurePeaks])

  const hasPeaks = !!peaks && peaks.bucketCount > 0

  // Zoom window over the whole file, [0,1]. Reset when the sound changes or the
  // row stops being the active one (a background row is never zoomed).
  const [zoom, setZoom] = useState<{ start: number; end: number }>(FULL_WINDOW)
  useEffect(() => {
    setZoom(FULL_WINDOW)
  }, [soundId, active])

  // ---- fallback image mask gating (unchanged from ticket 03) ----------
  useEffect(() => {
    if (hasPeaks) return
    if (shown.has(soundId)) {
      setMasked(true)
      return
    }
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      shown.add(soundId)
      setMasked(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            shown.add(soundId)
            setMasked(true)
            io.disconnect()
            return
          }
        }
      },
      { rootMargin: '250px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [soundId, hasPeaks])

  // ---- canvas drawing ------------------------------------------------
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
        color: 'rgba(52, 211, 153, 0.85)', // emerald-400/85
        midColor: 'rgba(52, 211, 153, 0.25)',
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

  // ---- playhead node ----------------------------------------------
  useEffect(() => {
    if (!active) return
    const node = playheadRef.current
    if (!node) return
    registerPlayheadNode(soundId, node)
    return () => unregisterPlayheadNode(soundId)
  }, [active, soundId])

  // Keep the playhead's zoom-mapping vars current.
  useEffect(() => {
    const node = playheadRef.current
    if (!node) return
    node.style.setProperty('--pz0', String(zoom.start))
    node.style.setProperty(
      '--pspan',
      String(Math.max(zoom.end - zoom.start, 1e-6)),
    )
  }, [zoom])

  // ---- scrub (click / drag) -------------------------------------
  const seekAt = useCallback(
    (clientX: number) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return
      const xFrac = (clientX - rect.left) / rect.width
      useTransport
        .getState()
        .seekFraction(pointerToFraction(xFrac, zoom.start, zoom.end))
    },
    [zoom],
  )

  const draggingRef = useRef(false)
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!active) return
      draggingRef.current = true
      e.currentTarget.setPointerCapture?.(e.pointerId)
      seekAt(e.clientX)
    },
    [active, seekAt],
  )
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      seekAt(e.clientX)
    },
    [seekAt],
  )
  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])

  // ---- zoom (wheel over an active canvas waveform) -----------------
  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (!active || !hasPeaks) return
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return
      const focus = (e.clientX - rect.left) / rect.width
      // Wheel up (deltaY < 0) zooms in.
      const factor = e.deltaY < 0 ? 0.85 : 1 / 0.85
      setZoom((z) => zoomWindow(z.start, z.end, factor, focus))
    },
    [active, hasPeaks],
  )
  const resetZoom = useCallback(() => setZoom(FULL_WINDOW), [])

  const zoomed = zoom.start > 0 || zoom.end < 1

  const maskStyle = masked
    ? ({
        WebkitMaskImage: `url("${url}")`,
        maskImage: `url("${url}")`,
      } as const)
    : undefined

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={resetZoom}
      onWheel={onWheel}
      className={`relative overflow-hidden ${active ? 'cursor-pointer' : ''} ${className ?? ''}`}
    >
      {hasPeaks ? (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <div
          aria-hidden="true"
          className="waveform-mask absolute inset-0 bg-emerald-400/80"
          style={maskStyle}
        />
      )}

      {active && (
        <div
          ref={playheadRef}
          aria-hidden="true"
          className="waveform-playhead"
        />
      )}

      {active && hasPeaks && zoomed && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            resetZoom()
          }}
          className="absolute right-0.5 top-0.5 rounded bg-neutral-900/80 px-1 text-[9px] leading-tight text-neutral-300 hover:text-neutral-100"
          title="Reset zoom (or double-click the waveform)"
        >
          1:1
        </button>
      )}
    </div>
  )
})
