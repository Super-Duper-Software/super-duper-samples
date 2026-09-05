import type { Dispatch, SetStateAction } from 'react'
import type { EditSpec } from '../../../preload'
import type { ExportDialogState } from '../../lib/editSpecBuilder'
import { formatPreciseDuration } from '../../lib/format'

export const FORMATS: EditSpec['format'][] = ['wav', 'mp3', 'flac', 'ogg']
const SAMPLE_RATES = [44100, 48000, 96000]

const FIELD_CLASS = 'rounded border border-line bg-bg px-2 py-1 text-ink'

export interface ExportFormProps {
  form: ExportDialogState
  setForm: Dispatch<SetStateAction<ExportDialogState>>
  /** No region marked → "trim to region" is unavailable. */
  hasRegion: boolean
  outputDuration: number
  name: string
  defaultName: string
  onNameChange: (name: string) => void
  onCancel: () => void
  onConfirm: () => void
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-muted">{label}</span>
      {children}
    </label>
  )
}

export function ExportForm({
  form,
  setForm,
  hasRegion,
  outputDuration,
  name,
  defaultName,
  onNameChange,
  onCancel,
  onConfirm,
}: ExportFormProps) {
  return (
    <div className="flex flex-col gap-3 p-4 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={form.trimToRegion}
          disabled={!hasRegion}
          onChange={(e) =>
            setForm((f) => ({ ...f, trimToRegion: e.target.checked }))
          }
        />
        Trim to the marked region
        {!hasRegion && (
          <span className="text-xs text-ink-faint">(no region marked)</span>
        )}
      </label>

      <p className="text-xs tabular-nums text-ink-faint">
        Output duration: {formatPreciseDuration(outputDuration)}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Format">
          <select
            value={form.format}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                format: e.target.value as EditSpec['format'],
              }))
            }
            className={FIELD_CLASS}
          >
            {FORMATS.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Sample rate">
          <select
            value={form.sampleRate ?? 'source'}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                sampleRate:
                  e.target.value === 'source' ? undefined : Number(e.target.value),
              }))
            }
            className={FIELD_CLASS}
          >
            <option value="source">Same as source</option>
            {SAMPLE_RATES.map((r) => (
              <option key={r} value={r}>
                {r.toLocaleString()} Hz
              </option>
            ))}
          </select>
        </Field>

        <Field label="Channels">
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
            className={FIELD_CLASS}
          >
            <option value="source">Same as source</option>
            <option value={1}>Mono</option>
            <option value={2}>Stereo</option>
          </select>
        </Field>

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

      <Field label="Name">
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={defaultName}
          className={FIELD_CLASS}
        />
      </Field>

      <div className="mt-1 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-line px-3 py-1.5 text-ink-muted hover:border-line-strong hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded border border-accent bg-accent px-3 py-1.5 text-accent-on hover:bg-accent-hover"
        >
          Export
        </button>
      </div>
    </div>
  )
}
