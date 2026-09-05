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
        className="flex max-h-full w-full max-w-lg flex-col rounded-lg border border-line bg-surface shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard shortcuts"
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-auto p-4">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {group.title}
              </h3>
              {group.note && (
                <p className="mt-0.5 text-[11px] text-ink-faint">{group.note}</p>
              )}
              <dl className="mt-2 space-y-1.5">
                {group.items.map((s) => (
                  <div key={s.keys} className="flex items-baseline gap-3">
                    <dt className="w-32 shrink-0">
                      <kbd className="rounded border border-line bg-surface-raised px-1.5 py-0.5 text-[11px] font-medium text-ink">
                        {s.keys}
                      </kbd>
                    </dt>
                    <dd className="text-xs text-ink-muted">{s.description}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-[11px] text-ink-faint">
          <span>Something broken? The app log has the details.</span>
          <button
            type="button"
            onClick={onOpenLogs}
            className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
          >
            View logs
          </button>
        </div>
      </div>
    </div>
  )
}
