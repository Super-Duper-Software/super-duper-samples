import { memo } from 'react'

/** Brand licence-semantic classes per family, for the always-dark app. */
function chipClasses(name: string): string {
  if (name === 'CC0') return 'border-license-open text-license-open'
  if (name.includes('NC'))
    return 'border-2 border-license-caution text-license-caution'
  if (name.startsWith('CC-BY')) return 'border-license-attribution text-license-attribution'
  if (name === 'Sampling+') return 'border-license-legacy text-license-legacy'
  return 'border-line bg-surface-raised text-ink-muted'
}

export const LicenseChip = memo(function LicenseChip({
  name,
  className = '',
}: {
  name: string
  /** Extra classes from the caller (e.g. `w-full` to fill an alignment slot). */
  className?: string
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide ${chipClasses(
        name,
      )} ${className}`}
      title={`License: ${name}`}
    >
      {name}
    </span>
  )
})
