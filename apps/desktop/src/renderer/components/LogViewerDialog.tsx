// Ticket 18 — "the app's own logs are accessible from the interface for
// reporting problems." Shows the tail of the log in-app (no need to hunt for a
// file), with a button to reveal the actual file for attaching to a bug report.

import { useCallback, useEffect, useState } from 'react'

interface LogViewerDialogProps {
  onClose: () => void
}

const TAIL_LINES = 400

export function LogViewerDialog({ onClose }: LogViewerDialogProps) {
  const [lines, setLines] = useState<string[] | null>(null)
  const [path, setPath] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void window.core.readLog({ maxLines: TAIL_LINES }).then(setLines)
    void window.core.getLogPath().then(setPath)
  }, [])

  useEffect(() => refresh(), [refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col rounded-lg border border-line bg-surface shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Application log"
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">
              Application log
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-ink-faint">
              {path ?? 'No log file on this system.'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={() => void window.core.showLogs()}
              className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
            >
              Reveal file
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
            >
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-bg p-4">
          {lines === null ? (
            <p className="text-sm text-ink-muted">Loading…</p>
          ) : lines.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Nothing logged yet — that is a good sign.
            </p>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-muted">
              {lines.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
