// Ticket 18 — renders the notification stack from `useNotifications`. Bottom
// right, above the transport bar. Each kind gets its own colour so the user can
// tell connectivity from throttling from a disk problem at a glance; each says
// what to do when there is something to do, and says so plainly when there is
// not (`actionable === false`).

import type { ErrorKind } from '../../preload'
import { useNotifications } from '../store/useNotifications'

const KIND_STYLE: Record<ErrorKind, { ring: string; badge: string; label: string }> = {
  network: {
    ring: 'border-amber-600/70 bg-amber-950/70',
    badge: 'bg-amber-500/20 text-amber-200',
    label: 'Connection',
  },
  throttled: {
    ring: 'border-amber-600/70 bg-amber-950/70',
    badge: 'bg-amber-500/20 text-amber-200',
    label: 'Rate limit',
  },
  auth: {
    ring: 'border-sky-600/70 bg-sky-950/70',
    badge: 'bg-sky-500/20 text-sky-200',
    label: 'Sign-in',
  },
  download: {
    ring: 'border-red-700/70 bg-red-950/70',
    badge: 'bg-red-500/20 text-red-200',
    label: 'Download',
  },
  disk: {
    ring: 'border-red-700/70 bg-red-950/70',
    badge: 'bg-red-500/20 text-red-200',
    label: 'Disk',
  },
  unknown: {
    ring: 'border-neutral-600 bg-neutral-900',
    badge: 'bg-neutral-700/60 text-neutral-200',
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
                <span className="text-xs font-semibold text-neutral-100">
                  {n.title}
                </span>
              </div>
              <button
                type="button"
                onClick={() => dismiss(n.id)}
                aria-label="Dismiss"
                className="-mr-1 -mt-1 shrink-0 rounded px-1 text-neutral-400 hover:text-neutral-100"
              >
                ×
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-neutral-300">
              {n.detail}
            </p>
            {!n.actionable && (
              <p className="mt-1 text-[10px] italic text-neutral-500">
                Nothing you need to do here.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
