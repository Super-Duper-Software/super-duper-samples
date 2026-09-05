import { useCallback, useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { drawPeakWaveform } from '../../lib/waveformPeaks'
import * as editAudio from '../../store/editAudioController'
import type { PeaksEntry } from '../../store/usePeaks'
import type { WaveformGestures } from './useWaveformGestures'

const WAVE_COLOR = 'rgba(255, 90, 31, 0.9)'
const WAVE_MID_COLOR = 'rgba(255, 90, 31, 0.3)'

/**
 * The waveform box: the peaks canvas, the region overlay and the playhead. The
 * playhead node is handed to the audio controller, which moves it directly —
 * it never re-renders through React.
 */
export function EditWaveform({
  boxRef,
  peaks,
  hasPeaks,
  gestures,
}: {
  boxRef: RefObject<HTMLDivElement | null>
  peaks: PeaksEntry
  hasPeaks: boolean
  gestures: WaveformGestures
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const { zoom, region, toBoxPct } = gestures

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
        color: WAVE_COLOR,
        midColor: WAVE_MID_COLOR,
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

  return (
    <div
      ref={boxRef}
      onPointerDown={gestures.onPointerDown}
      onPointerMove={gestures.onPointerMove}
      onPointerUp={gestures.onPointerUp}
      onPointerCancel={gestures.onPointerUp}
      onDoubleClick={gestures.resetZoom}
      onWheel={gestures.onWheel}
      className="relative min-h-0 flex-1 cursor-crosshair overflow-hidden rounded border border-line bg-surface"
    >
      {hasPeaks && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="absolute inset-0 h-full w-full"
        />
      )}

      {region && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 bg-bg/70"
            style={{ width: `${Math.max(0, toBoxPct(region.start))}%` }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 bg-bg/70"
            style={{ width: `${Math.max(0, 100 - toBoxPct(region.end))}%` }}
          />
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
  )
}
