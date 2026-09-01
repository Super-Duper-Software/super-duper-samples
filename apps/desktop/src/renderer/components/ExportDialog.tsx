// Ticket 08 — the Edit view's export dialog. Wired to `createEdit`: builds an
// `EditSpec` from the form state (`editSpecBuilder.ts`, pure + unit-tested)
// plus the marked region handed down from `EditView`, shows render progress
// from `onEditProgress`, and lets the user cancel mid-render via `cancelEdit`.
//
// Opening / adjusting this dialog never touches `region` — it only reads it —
// so closing without exporting (or cancelling mid-render) leaves the Edit
// view exactly as it was.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Sound } from '../../core/types'
import type { EditEvent, EditSpec } from '../../preload'
import { buildEditSpec, suggestedExportName } from '../lib/editSpecBuilder'
import type { ExportDialogState } from '../lib/editSpecBuilder'
import type { Region } from '../lib/regionGeometry'
import { formatPreciseDuration } from '../lib/format'
import { useLibrary } from '../store/useLibrary'

const FORMATS: EditSpec['format'][] = ['wav', 'mp3', 'flac', 'ogg']
const SAMPLE_RATES = [44100, 48000, 96000]

type Status =
  | { kind: 'form' }
  | { kind: 'rendering'; progress: number }
  | { kind: 'error'; message: string }

export interface ExportDialogProps {
  sound: Sound
  /**
   * The name to base the `"<name> Edited"` default on and to show in the
   * dialog — the Sound's EFFECTIVE name (`customName ?? name`), not
   * `sound.name` alone: for an Edit being re-exported, `sound.name` is only
   * ever the core's bare `edited` / `edited (N)` fallback (ADR-0005), never
   * what the user actually named it.
   */
  sourceName: string
  region: Region | null
  onClose: () => void
  /** Called once the Edit is fully in the Library, before the dialog closes. */
  onExported: (editId: number) => void
}

export function ExportDialog({
  sound,
  sourceName,
  region,
  onClose,
  onExported,
}: ExportDialogProps) {
  const [status, setStatus] = useState<Status>({ kind: 'form' })
  const [name, setName] = useState('')
  const [defaultName, setDefaultName] = useState(() => `${sourceName} Edited`)
  const nameTouched = useRef(false)
  const cancelRequested = useRef(false)

  const [form, setForm] = useState<ExportDialogState>({
    trimToRegion: !!region,
    format: FORMATS.includes(sound.type as EditSpec['format'])
      ? (sound.type as EditSpec['format'])
      : 'wav',
    normalize: false,
  })

  // Pre-fill the name field with `"<source name> Edited"`, or the next free
  // `"<source name> Edited (N)"` once that is taken by an existing Edit of
  // this same parent.
  useEffect(() => {
    let cancelled = false
    void window.core
      .listLibrary()
      .then((sounds) => {
        if (cancelled) return
        const existing = sounds
          .filter((s) => s.derivedFrom === sound.id)
          .map((s) => s.effectiveName)
        const next = suggestedExportName(sourceName, existing)
        setDefaultName(next)
        if (!nameTouched.current) setName(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sound.id, sourceName])

  useEffect(() => {
    const unsubscribe = window.core.onEditProgress((event: EditEvent) => {
      if (event.parentSoundId !== sound.id) return
      if (event.status === 'progress') {
        setStatus((s) =>
          s.kind === 'rendering' ? { kind: 'rendering', progress: event.progress } : s,
        )
      } else if (event.status === 'failed' && !cancelRequested.current) {
        setStatus({ kind: 'error', message: event.error })
      }
    })
    return unsubscribe
  }, [sound.id])

  const handleCancel = useCallback(() => {
    cancelRequested.current = true
    void window.core.cancelEdit(sound.id)
    setStatus({ kind: 'form' })
  }, [sound.id])

  const handleClose = useCallback(() => {
    if (status.kind === 'rendering') handleCancel()
    onClose()
  }, [status.kind, handleCancel, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  const handleConfirm = useCallback(async () => {
    cancelRequested.current = false
    setStatus({ kind: 'rendering', progress: 0 })
    const spec = buildEditSpec(form, region, sound.duration)
    const trimmedName = name.trim()

    try {
      const result = await window.core.createEdit(sound.id, spec)
      if (result === null) {
        // A silent no-op — either our own cancel, or the parent Sound/Original
        // vanished underneath us. Either way there is nothing to surface.
        if (!cancelRequested.current) setStatus({ kind: 'form' })
        return
      }
      // Always apply the name — `createEdit` itself only ever falls back to
      // its own bare `edited` / `edited (N)` (`src/core/edits/editName.ts`),
      // which is not the scheme this dialog pre-fills, so leaving this to
      // "only when changed from the default" would silently drop our own
      // default the moment the user accepts it as-is.
      if (trimmedName) {
        await window.core.setCustomName(result.editId, trimmedName)
      }
      useLibrary.getState().noteCreated(result.editId)
      onExported(result.editId)
      onClose()
    } catch (err) {
      if (cancelRequested.current) return
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [form, region, sound.id, sound.duration, name, defaultName, onExported, onClose])

  const rendering = status.kind === 'rendering'
  const durationPreview =
    form.trimToRegion && region
      ? Math.max(0, (region.end - region.start) * sound.duration)
      : sound.duration

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={handleClose}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-lg border border-line bg-surface shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Export as Edit"
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Export as Edit</h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close export dialog"
            className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
          >
            ✕
          </button>
        </div>

        {status.kind === 'error' && (
          <div className="mx-4 mt-3 rounded border border-error p-2 text-xs text-error">
            Export failed: {status.message}
          </div>
        )}

        {rendering ? (
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm text-ink-muted" aria-live="polite">
              Rendering… {Math.round(status.progress * 100)}%
            </p>
            <div className="h-2 overflow-hidden rounded-full bg-bg-inset">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round(status.progress * 100)}%` }}
              />
            </div>
            <button
              type="button"
              onClick={handleCancel}
              className="self-start rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.trimToRegion}
                disabled={!region}
                onChange={(e) =>
                  setForm((f) => ({ ...f, trimToRegion: e.target.checked }))
                }
              />
              Trim to the marked region
              {!region && (
                <span className="text-xs text-ink-faint">(no region marked)</span>
              )}
            </label>

            <p className="text-xs tabular-nums text-ink-faint">
              Output duration: {formatPreciseDuration(durationPreview)}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-muted">Format</span>
                <select
                  value={form.format}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      format: e.target.value as EditSpec['format'],
                    }))
                  }
                  className="rounded border border-line bg-bg px-2 py-1 text-ink"
                >
                  {FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-muted">Sample rate</span>
                <select
                  value={form.sampleRate ?? 'source'}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      sampleRate:
                        e.target.value === 'source'
                          ? undefined
                          : Number(e.target.value),
                    }))
                  }
                  className="rounded border border-line bg-bg px-2 py-1 text-ink"
                >
                  <option value="source">Same as source</option>
                  {SAMPLE_RATES.map((r) => (
                    <option key={r} value={r}>
                      {r.toLocaleString()} Hz
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-muted">Channels</span>
                <select
                  value={form.channels ?? 'source'}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      channels:
                        e.target.value === 'source'
                          ? undefined
                          : (Number(e.target.value) as 1 | 2),
                    }))
                  }
                  className="rounded border border-line bg-bg px-2 py-1 text-ink"
                >
                  <option value="source">Same as source</option>
                  <option value={1}>Mono</option>
                  <option value={2}>Stereo</option>
                </select>
              </label>

              <label className="flex items-end gap-2 pb-1.5">
                <input
                  type="checkbox"
                  checked={form.normalize}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, normalize: e.target.checked }))
                  }
                />
                <span className="text-xs text-ink-muted">Loudness-normalise</span>
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-muted">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  nameTouched.current = true
                  setName(e.target.value)
                }}
                placeholder={defaultName}
                className="rounded border border-line bg-bg px-2 py-1 text-ink"
              />
            </label>

            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded border border-line px-3 py-1.5 text-ink-muted hover:border-line-strong hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                className="rounded border border-accent bg-accent px-3 py-1.5 text-accent-on hover:bg-accent-hover"
              >
                Export
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
