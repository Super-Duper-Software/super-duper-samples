// Ticket 18 — the keyboard-shortcut reference. Opened with `?` or the header
// button. Renders straight from `lib/shortcuts.ts`, the single source of truth,
// so what it shows and what the list actually does cannot drift apart.

import { useEffect } from 'react'
import { SHORTCUT_GROUPS } from '../lib/shortcuts'

interface ShortcutsDialogProps {
  onClose: () => void
  /** Open the log viewer — reachable from here because both are "how do I…" help. */
  onOpenLogs: () => void
}

export function ShortcutsDialog({ onClose, onOpenLogs }: ShortcutsDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-lg flex-col rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <div className="flex items-center justify-between gap-4 border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {group.title}
              </h3>
              {group.note && (
                <p className="mt-0.5 text-[11px] text-neutral-500">{group.note}</p>
              )}
              <dl className="mt-2 space-y-1.5">
                {group.items.map((s) => (
                  <div key={s.keys} className="flex items-baseline gap-3">
                    <dt className="w-32 shrink-0">
                      <kbd className="rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-[11px] font-medium text-neutral-200">
                        {s.keys}
                      </kbd>
                    </dt>
                    <dd className="text-xs text-neutral-300">{s.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-neutral-800 px-4 py-3 text-[11px] text-neutral-500">
          <span>Something broken? The app log has the details.</span>
          <button
            type="button"
            onClick={onOpenLogs}
            className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-500 hover:text-neutral-100"
          >
            View logs
          </button>
        </div>
      </div>
    </div>
  )
}
