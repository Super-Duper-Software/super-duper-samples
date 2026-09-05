import { create } from 'zustand'
import type { ClassifiedError, ErrorKind } from '../../preload'
import { classifyError } from '../../core/errors'

export interface Notification extends ClassifiedError {
  id: number
  at: number
}

interface NotificationsState {
  items: Notification[]
  /** Classify and show any thrown value. Returns the notification id. */
  report: (error: unknown, context?: string) => number
  /** Show an already-classified error (e.g. one derived from a status push). */
  push: (error: ClassifiedError, context?: string) => number
  dismiss: (id: number) => void
  clear: () => void
}

let seq = 1

/** Kinds that clear themselves; disk / unknown stay until dismissed. */
const AUTO_DISMISS: Partial<Record<ErrorKind, number>> = {
  network: 9000,
  throttled: 12000,
  auth: 12000,
  download: 9000,
}

function logToCore(n: ClassifiedError, context?: string): void {
  try {
    void window.core?.log?.('error', `${context ? context + ': ' : ''}${n.title}`, {
      kind: n.kind,
      detail: n.detail,
    })
  } catch {
    /* no bridge (tests) */
  }
}

export const useNotifications = create<NotificationsState>((set, get) => ({
  items: [],

  report: (error, context) => get().push(classifyError(error), context),

  push: (error, context) => {
    const existing = get().items.find(
      (n) => n.kind === error.kind && n.title === error.title,
    )
    if (existing) {
      set((s) => ({
        items: s.items.map((n) =>
          n.id === existing.id ? { ...n, ...error, at: Date.now() } : n,
        ),
      }))
      return existing.id
    }

    const id = seq++
    const note: Notification = { ...error, id, at: Date.now() }
    logToCore(error, context)
    set((s) => ({ items: [...s.items, note] }))

    const ttl = AUTO_DISMISS[error.kind]
    if (ttl) {
      setTimeout(() => {
        const still = get().items.find((n) => n.id === id)
        if (still && Date.now() - still.at >= ttl - 50) get().dismiss(id)
      }, ttl)
    }
    return id
  },

  dismiss: (id) => set((s) => ({ items: s.items.filter((n) => n.id !== id) })),
  clear: () => set({ items: [] }),
}))
