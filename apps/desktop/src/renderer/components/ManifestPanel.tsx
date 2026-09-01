// Ticket 17 — the Attribution Manifest viewer.
//
// Opened from the Collections view for the currently-open Collection. On mount it
// asks the core for a Manifest (a SNAPSHOT — see `core.generateManifest`), shows
// the plain-text document read-only, and offers the two things the user actually
// needs: copy to clipboard, and save to a file they choose. The snapshot is
// taken once, here; re-opening the panel takes a fresh one.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Manifest } from '../../preload'

interface ManifestPanelProps {
  collectionId: number
  collectionName: string
  onClose: () => void
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; manifest: Manifest }
  | { status: 'error' }

/** `Attribution - Client Ferry Ad.txt`, stripped of path-hostile characters. */
function defaultFileName(collectionName: string): string {
  const safe = collectionName.replace(/[/\\:*?"<>|]+/g, ' ').trim() || 'collection'
  return `Attribution - ${safe}.txt`
}

export function ManifestPanel({
  collectionId,
  collectionName,
  onClose,
}: ManifestPanelProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [flash, setFlash] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    window.core
      .generateManifest(collectionId)
      .then((manifest) => {
        if (!cancelled) setState({ status: 'ok', manifest })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [collectionId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current)
    },
    [],
  )

  const showFlash = useCallback((msg: string) => {
    setFlash(msg)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 2500)
  }, [])

  const manifest = state.status === 'ok' ? state.manifest : null

  const onCopy = useCallback(async () => {
    if (!manifest) return
    try {
      await navigator.clipboard.writeText(manifest.text)
      showFlash('Copied to clipboard')
    } catch {
      showFlash('Could not access the clipboard')
    }
  }, [manifest, showFlash])

  const onSave = useCallback(async () => {
    if (!manifest) return
    try {
      const res = await window.core.saveManifest(
        defaultFileName(collectionName),
        manifest.text,
      )
      if (res.saved) showFlash(`Saved to ${res.path ?? 'file'}`)
    } catch {
      showFlash('Could not save the file')
    }
  }, [manifest, collectionName, showFlash])

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-6"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-2xl flex-col rounded-lg border border-line bg-surface shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">
              Attribution manifest — {collectionName}
            </h2>
            {manifest && (
              <p className="mt-0.5 text-[11px] text-ink-faint">
                Snapshot taken {new Date(manifest.generatedAt).toLocaleString()}.
                Changing the collection later will not alter this document.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {state.status === 'loading' && (
            <p className="text-sm text-ink-muted">Generating…</p>
          )}
          {state.status === 'error' && (
            <p className="text-sm text-error" role="alert">
              Could not generate the manifest for this collection.
            </p>
          )}
          {manifest && (
            <>
              {manifest.summary.nonCommercial > 0 && (
                <p
                  role="alert"
                  className="mb-3 rounded border border-license-caution bg-surface-raised px-3 py-2 text-xs font-medium text-license-caution"
                >
                  ⚠ {manifest.summary.nonCommercial}{' '}
                  {manifest.summary.nonCommercial === 1 ? 'sound is' : 'sounds are'}{' '}
                  licensed for non-commercial use only. Do not ship{' '}
                  {manifest.summary.nonCommercial === 1 ? 'it' : 'them'} in paid
                  work.
                </p>
              )}
              <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink">
                {manifest.text}
              </pre>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
          <span className="text-[11px] text-ok" aria-live="polite">
            {flash ?? ''}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              disabled={!manifest}
              className="rounded border border-line px-2 py-1 text-xs text-ink hover:border-line-strong hover:text-ink disabled:opacity-40"
            >
              Copy to clipboard
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={!manifest}
              className="rounded border border-accent-2 bg-surface-raised px-2 py-1 text-xs text-accent-2-text hover:border-accent-2 hover:text-accent-2-text disabled:opacity-40"
            >
              Save to file…
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
