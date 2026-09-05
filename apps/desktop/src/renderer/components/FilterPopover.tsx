import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface FilterPopoverProps {
  /** Number of active constraints — shown as a badge, and drives "is it on?". */
  count: number
  /** The filter controls. Rendered inside the panel only while it is open. */
  children: ReactNode
  /** Clears every constraint; rendered as the panel's footer action. */
  onClearAll: () => void
  /** Trigger label. Defaults to "Filters". */
  label?: string
}

export function FilterPopover({
  count,
  children,
  onClearAll,
  label = 'Filters',
}: FilterPopoverProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = count > 0

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
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={[
          'inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs',
          active
            ? 'border-accent-2 text-accent-2-text hover:bg-surface-raised'
            : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
        ].join(' ')}
      >
        <span>{label}</span>
        {active && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-2 px-1 text-[10px] font-medium tabular-nums text-accent-2-on">
            {count}
          </span>
        )}
        <span aria-hidden className="text-[10px] text-current opacity-70">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`${label} options`}
          className="absolute left-0 z-20 mt-1 w-80 rounded border border-line bg-surface p-3 shadow-lg"
        >
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">{children}</div>
          <div className="mt-3 flex justify-end border-t border-line pt-2">
            <button
              type="button"
              onClick={onClearAll}
              disabled={!active}
              className="rounded px-2 py-1 text-[11px] text-ink-muted hover:bg-surface-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
            >
              Clear all
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
