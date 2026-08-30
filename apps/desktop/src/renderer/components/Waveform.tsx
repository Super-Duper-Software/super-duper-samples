// Freesound's pre-rendered waveform PNG, recoloured to the app palette by using
// it as a CSS mask over a themed-colour element (spec 0001 § Waveforms, ticket
// 03). Never an <img> — an <img> would paint Freesound's own grey pixels and
// look pasted in.
//
// Loading discipline:
//   - The row is only mounted while the virtualizer keeps it in range, so the
//     mask URL is only ever referenced for rows at/near the viewport.
//   - An IntersectionObserver holds the mask back until the element is actually
//     near the viewport (belt-and-braces with the virtualizer's overscan).
//   - Once a sound's waveform has been shown, its id is remembered module-wide,
//     so scrolling back re-applies the mask synchronously with no new work and
//     the browser serves the PNG from its HTTP cache — no churn per scroll frame.
//
// Ticket 04 adds a playhead. When `active` (this row is the sound being
// auditioned) the component renders a thin overlay bar and registers its DOM
// node with `audioController`, which moves it at 60fps by writing the
// `--playhead` CSS variable DIRECTLY on that node. React is not involved in the
// motion — this component does not re-render as the playhead advances. Clicking
// the waveform while active seeks.

import { memo, useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import {
  registerPlayheadNode,
  unregisterPlayheadNode,
} from '../store/audioController'
import { useTransport } from '../store/useTransport'

/** Sound ids whose waveform has been shown at least once this session. */
const shown = new Set<number>()

export interface WaveformProps {
  soundId: number
  /** `sound.waveformUrls.m` — the medium pre-rendered PNG. */
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
  const playheadRef = useRef<HTMLDivElement>(null)
  const [masked, setMasked] = useState(() => shown.has(soundId))

  useEffect(() => {
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
  }, [soundId])

  // Hand the playhead node to the audio controller while this row is active.
  useEffect(() => {
    if (!active) return
    const node = playheadRef.current
    if (!node) return
    registerPlayheadNode(soundId, node)
    return () => unregisterPlayheadNode(soundId)
  }, [active, soundId])

  // Only the mask URL is dynamic; size/repeat/position live in a static CSS
  // class so React never rewrites them and the compositor is not thrashed.
  const style = masked
    ? ({
        WebkitMaskImage: `url("${url}")`,
        maskImage: `url("${url}")`,
      } as const)
    : undefined

  function onClick(e: MouseEvent<HTMLDivElement>) {
    if (!active) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    useTransport.getState().seekFraction((e.clientX - rect.left) / rect.width)
  }

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`relative overflow-hidden ${active ? 'cursor-pointer' : ''} ${className ?? ''}`}
    >
      <div
        aria-hidden="true"
        className="waveform-mask absolute inset-0 bg-emerald-400/80"
        style={style}
      />
      {active && (
        <div ref={playheadRef} aria-hidden="true" className="waveform-playhead" />
      )}
    </div>
  )
})
