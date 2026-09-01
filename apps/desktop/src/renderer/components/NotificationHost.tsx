// Ticket 18 — renders the notification stack from `useNotifications`. Bottom
// right, above the transport bar. Each kind gets its own colour so the user can
// tell connectivity from throttling from a disk problem at a glance; each says
// what to do when there is something to do, and says so plainly when there is
// not (`actionable === false`).

import type { ErrorKind } from '../../preload'
import { useNotifications } from '../store/useNotifications'

const KIND_STYLE: Record<ErrorKind, { ring: string; badge: string; label: string }> = {
  network: {
    ring: 'border-warn bg-surface',
    badge: 'bg-surface-raised text-warn',
    label: 'Connection',
  },
  throttled: {
    ring: 'border-warn bg-surface',
    badge: 'bg-surface-raised text-warn',
    label: 'Rate limit',
  },
  auth: {
    ring: 'border-accent-2 bg-surface',
    badge: 'bg-surface-raised text-accent-2-text',
    label: 'Sign-in',
  },
  download: {
    ring: 'border-error bg-surface',
    badge: 'bg-surface-raised text-error',
    label: 'Download',
  },
  disk: {
    ring: 'border-error bg-surface',
    badge: 'bg-surface-raised text-error',
    label: 'Disk',
  },
  unknown: {
    ring: 'border-line-strong bg-surface',
    badge: 'bg-surface-raised text-ink',
    label: 'Error',
  },
}

export function NotificationHost() {
  const items = useNotifications((s) => s.items)
  const dismiss = useNotifications((s) => s.dismiss)
  if (items.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-24 right-3 z-40 flex w-80 flex-col gap-2">
      {items.map((n) => {
        const style = KIND_STYLE[n.kind]
        return (
          <div
            key={n.id}
            role="alert"
            className={`pointer-events-auto rounded-lg border px-3 py-2.5 shadow-lg ${style.ring}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style.badge}`}
                >
                  {style.label}
                </span>
                <span className="text-xs font-semibold text-ink">
                  {n.title}
                </span>
              </div>
              <button
                type="button"
                onClick={() => dismiss(n.id)}
                aria-label="Dismiss"
                className="-mr-1 -mt-1 shrink-0 rounded px-1 text-ink-muted hover:text-ink"
              >
                ×
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
              {n.detail}
            </p>
            {!n.actionable && (
              <p className="mt-1 text-[10px] italic text-ink-faint">
                Nothing you need to do here.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
