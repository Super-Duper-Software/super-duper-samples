import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type {
  DragEvent as ReactDragEvent,
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

  const [zoom, setZoom] = useState<{ start: number; end: number }>(FULL_WINDOW)
  useEffect(() => {
    setZoom(FULL_WINDOW)
  }, [soundId, active])

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
        color: 'rgba(255, 90, 31, 0.9)', // --sd-wave-played (hot orange)
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

  useEffect(() => {
    if (!active) return
    const node = playheadRef.current
    if (!node) return
    registerPlayheadNode(soundId, node)
    return () => unregisterPlayheadNode(soundId)
  }, [active, soundId])

  useEffect(() => {
    const node = playheadRef.current
    if (!node) return
    node.style.setProperty('--pz0', String(zoom.start))
    node.style.setProperty(
      '--pspan',
      String(Math.max(zoom.end - zoom.start, 1e-6)),
    )
  }, [zoom])

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

  const onDragStart = useCallback(
    (e: ReactDragEvent<HTMLDivElement>) => {
      if (!active) return
      e.preventDefault()
      e.stopPropagation()
    },
    [active],
  )

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (!active || !hasPeaks) return
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return
      const focus = (e.clientX - rect.left) / rect.width
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
      onDragStart={onDragStart}
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
          className="waveform-mask absolute inset-0 bg-[var(--sd-wave-played)]"
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
          className="absolute right-0.5 top-0.5 rounded bg-surface-raised px-1 text-[9px] leading-tight text-ink-muted hover:text-ink"
          title="Reset zoom (or double-click the waveform)"
        >
          1:1
        </button>
      )}
    </div>
  )
})
