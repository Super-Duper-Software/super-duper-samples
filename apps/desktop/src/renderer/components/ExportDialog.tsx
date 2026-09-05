import { useCallback, useEffect, useRef, useState } from 'react'
import type { Sound } from '../../core/types'
import { errorMessage } from '../../core/errorMessage'
import type { EditEvent, EditSpec } from '../../preload'
import { buildEditSpec, suggestedExportName } from '../lib/editSpecBuilder'
import type { ExportDialogState } from '../lib/editSpecBuilder'
import type { Region } from '../lib/regionGeometry'
import { useLibrary } from '../store/useLibrary'
import { ExportForm, FORMATS } from './export/ExportForm'

type Status =
  | { kind: 'form' }
  | { kind: 'rendering'; progress: number }
  | { kind: 'error'; message: string }

export interface ExportDialogProps {
  sound: Sound
  /**
   * The Sound's EFFECTIVE name (`customName ?? name`): for an Edit being
   * re-exported, `sound.name` is only ever the core's bare `edited` / `edited (N)`
   * fallback (ADR-0005), never what the user named it.
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
    return window.core.onEditProgress((event: EditEvent) => {
      if (event.parentSoundId !== sound.id) return
      if (event.status === 'progress') {
        setStatus((s) =>
          s.kind === 'rendering'
            ? { kind: 'rendering', progress: event.progress }
            : s,
        )
      } else if (event.status === 'failed' && !cancelRequested.current) {
        setStatus({ kind: 'error', message: event.error })
      }
    })
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
        if (!cancelRequested.current) setStatus({ kind: 'form' })
        return
      }
      if (trimmedName) {
        await window.core.setCustomName(result.editId, trimmedName)
      }
      useLibrary.getState().noteCreated(result.editId)
      onExported(result.editId)
      onClose()
    } catch (err) {
      if (cancelRequested.current) return
      setStatus({ kind: 'error', message: errorMessage(err) })
    }
  }, [form, region, sound.id, sound.duration, name, onExported, onClose])

  const outputDuration =
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

        {status.kind === 'rendering' ? (
          <RenderingProgress
            progress={status.progress}
            onCancel={handleCancel}
          />
        ) : (
          <ExportForm
            form={form}
            setForm={setForm}
            hasRegion={!!region}
            outputDuration={outputDuration}
            name={name}
            defaultName={defaultName}
            onNameChange={(next) => {
              nameTouched.current = true
              setName(next)
            }}
            onCancel={handleClose}
            onConfirm={() => void handleConfirm()}
          />
        )}
      </div>
    </div>
  )
}

function RenderingProgress({
  progress,
  onCancel,
}: {
  progress: number
  onCancel: () => void
}) {
  const percent = Math.round(progress * 100)
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-ink-muted" aria-live="polite">
        Rendering… {percent}%
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-bg-inset">
        <div
          className="h-full rounded-full bg-accent transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="self-start rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
      >
        Cancel
      </button>
    </div>
  )
}
