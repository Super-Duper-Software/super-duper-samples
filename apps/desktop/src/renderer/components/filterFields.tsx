import type { ChangeEvent, ReactNode } from 'react'

const CONTROL =
  'w-full rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-focus focus:outline-none'

const CAPTION = 'text-[10px] font-medium uppercase tracking-wide text-ink-faint'

/** A stacked caption + control cell for the panel grid. `wide` spans both columns. */
export function Field({
  label,
  children,
  wide,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? 'col-span-2' : ''}`}>
      <span className={CAPTION}>{label}</span>
      {children}
    </label>
  )
}

/** A `<select>` with the native arrow suppressed and our own `▾` drawn in. */
export function StyledSelect({
  value,
  onChange,
  children,
  'aria-label': ariaLabel,
}: {
  value: string | number
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void
  children: ReactNode
  'aria-label'?: string
}) {
  return (
    <span className="relative block">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={onChange}
        className={`${CONTROL} cursor-pointer appearance-none pr-7`}
      >
        {children}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-faint"
      >
        ▾
      </span>
    </span>
  )
}

/** The min–max seconds pair, identical in both panels. */
export function DurationRange({
  min,
  max,
  onMin,
  onMax,
}: {
  min: number | undefined
  max: number | undefined
  onMin: (e: ChangeEvent<HTMLInputElement>) => void
  onMax: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        step="0.1"
        inputMode="decimal"
        placeholder="min"
        aria-label="Minimum duration in seconds"
        className={CONTROL}
        value={min ?? ''}
        onChange={onMin}
      />
      <span aria-hidden className="text-ink-faint">
        –
      </span>
      <input
        type="number"
        min={0}
        step="0.1"
        inputMode="decimal"
        placeholder="max"
        aria-label="Maximum duration in seconds"
        className={CONTROL}
        value={max ?? ''}
        onChange={onMax}
      />
      <span className="text-[11px] text-ink-faint">s</span>
    </div>
  )
}

export { CONTROL as FILTER_CONTROL_CLASS }
