import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject, WheelEvent as ReactWheelEvent } from 'react'
import { panWindow, pointerToFraction, zoomWindow } from '../../lib/waveformPeaks'
import {
  hitTestEdge,
  moveRegionEdge,
  regionFromDrag,
  type Region,
} from '../../lib/regionGeometry'

export const FULL_WINDOW = { start: 0, end: 1 } as const

/** Pointer proximity to an edge that grabs it instead of starting a new region, in fraction-of-box units. */
const EDGE_HIT_FRACTION = 0.012
/** Per-event delta is clamped to ±this (px) before it drives zoom or pan. */
const MAX_WHEEL_STEP = 50
/** Zoom factor per clamped delta unit: e^(step * this). ~0.006 → a full flick ≈ 1.35×. */
const ZOOM_SENSITIVITY = 0.006
/** Fraction of the raw horizontal delta that becomes pan distance. */
const PAN_SENSITIVITY = 0.5
/** How long one wheel gesture stays locked to the axis it started on. */
const GESTURE_LOCK_MS = 140

export interface ZoomWindow {
  start: number
  end: number
}

export interface WaveformGestures {
  zoom: ZoomWindow
  resetZoom: () => void
  region: Region | null
  setRegion: (region: Region | null) => void
  /** Convert a file-relative fraction to a percentage across the visible box. */
  toBoxPct: (fileFraction: number) => number
  onWheel: (e: ReactWheelEvent<HTMLDivElement>) => void
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void
}

/**
 * Zoom / pan of the waveform window and the region the user drags on it.
 * Scrolling zooms, scrolling sideways (or Shift) pans, and one gesture stays on
 * whichever axis it started on so a trackpad flick does not wobble between them.
 */
export function useWaveformGestures(
  boxRef: RefObject<HTMLDivElement | null>,
  { zoomEnabled, regionEnabled }: { zoomEnabled: boolean; regionEnabled: boolean },
): WaveformGestures {
  const [zoom, setZoom] = useState<ZoomWindow>(FULL_WINDOW)
  const [region, setRegion] = useState<Region | null>(null)

  const gestureRef = useRef<{ axis: 'zoom' | 'pan'; until: number } | null>(null)
  const dragRef = useRef<
    | { kind: 'edge'; edge: 'start' | 'end' }
    | { kind: 'new'; anchor: number }
    | null
  >(null)

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (!zoomEnabled) return
      const rect = boxRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0) return

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
        setZoom((z) =>
          panWindow(z.start, z.end, (step / rect.width) * (z.end - z.start)),
        )
      } else {
        const focus = (e.clientX - rect.left) / rect.width
        const factor = Math.exp(clamp(e.deltaY) * ZOOM_SENSITIVITY)
        setZoom((z) => zoomWindow(z.start, z.end, factor, focus))
      }
    },
    [zoomEnabled, boxRef],
  )

  const fractionAt = useCallback(
    (clientX: number): number | null => {
      const rect = boxRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0) return null
      return pointerToFraction(
        (clientX - rect.left) / rect.width,
        zoom.start,
        zoom.end,
      )
    },
    [boxRef, zoom],
  )

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!regionEnabled) return
      const frac = fractionAt(e.clientX)
      if (frac == null) return
      e.currentTarget.setPointerCapture?.(e.pointerId)

      const hitRadius = EDGE_HIT_FRACTION * Math.max(zoom.end - zoom.start, 1e-6)
      const edge = region ? hitTestEdge(region, frac, hitRadius) : null
      if (edge) {
        dragRef.current = { kind: 'edge', edge }
      } else {
        dragRef.current = { kind: 'new', anchor: frac }
        setRegion(regionFromDrag(frac, frac))
      }
    },
    [regionEnabled, fractionAt, zoom, region],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const frac = fractionAt(e.clientX)
      if (frac == null) return
      if (drag.kind === 'new') {
        setRegion(regionFromDrag(drag.anchor, frac))
      } else {
        setRegion((r) => (r ? moveRegionEdge(r, drag.edge, frac) : r))
      }
    },
    [fractionAt],
  )

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }, [])

  const toBoxPct = useCallback(
    (fileFraction: number) =>
      ((fileFraction - zoom.start) / Math.max(zoom.end - zoom.start, 1e-6)) * 100,
    [zoom],
  )

  return {
    zoom,
    resetZoom: useCallback(() => setZoom(FULL_WINDOW), []),
    region,
    setRegion,
    toBoxPct,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
