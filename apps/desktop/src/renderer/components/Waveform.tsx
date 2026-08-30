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

import { memo, useEffect, useRef, useState } from 'react'

/** Sound ids whose waveform has been shown at least once this session. */
const shown = new Set<number>()

export interface WaveformProps {
  soundId: number
  /** `sound.waveformUrls.m` — the medium pre-rendered PNG. */
  url: string
  className?: string
}

export const Waveform = memo(function Waveform({ soundId, url, className }: WaveformProps) {
  const ref = useRef<HTMLDivElement>(null)
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

  // Only the mask URL is dynamic; size/repeat/position live in a static CSS
  // class so React never rewrites them and the compositor is not thrashed.
  const style = masked
    ? ({
        WebkitMaskImage: `url("${url}")`,
        maskImage: `url("${url}")`,
      } as const)
    : undefined

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`waveform-mask bg-emerald-400/80 ${className ?? ''}`}
      style={style}
    />
  )
})
