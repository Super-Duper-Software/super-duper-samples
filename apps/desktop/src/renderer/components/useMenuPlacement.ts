import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

export interface MenuPosition {
  top: number
  left: number
}

/**
 * Fixed-position coordinates for a portalled panel of `width`, anchored under
 * the trigger and flipped above it when it would overflow the viewport bottom.
 * `null` until measured — render the panel hidden until then so it does not
 * flash at the wrong place. Re-measures on scroll and resize.
 */
export function useMenuPlacement(args: {
  open: boolean
  width: number
  triggerRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLElement | null>
  /** Re-measure when this changes (e.g. the item count altered the height). */
  remeasureKey?: unknown
}): MenuPosition | null {
  const { open, width, triggerRef, panelRef, remeasureKey } = args
  const [pos, setPos] = useState<MenuPosition | null>(null)

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const place = () => {
      const t = triggerRef.current?.getBoundingClientRect()
      if (!t) return
      const panelH = panelRef.current?.offsetHeight ?? 0
      const below = t.bottom + 4
      const flip = panelH > 0 && below + panelH > window.innerHeight
      setPos({
        top: flip ? Math.max(4, t.top - 4 - panelH) : below,
        left: Math.max(
          4,
          Math.min(t.right - width, window.innerWidth - width - 4),
        ),
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, width, triggerRef, panelRef, remeasureKey])

  return pos
}
