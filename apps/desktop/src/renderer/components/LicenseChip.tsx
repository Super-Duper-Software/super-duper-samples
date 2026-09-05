// An informational chip showing a Sound's License short name (CONTEXT.md
// § License). It is NOT a filter and NOT a badge of quality — it names an
// obligation attached to the audio. It maps to the brand's licence-semantic
// tokens (brand/BRAND.md § Colour), not to brand colours.
//
// Brand HARD RULE: licence chips must differ by LABEL + SHAPE, never by hue
// alone — the caution token sits close to the brand orange and ~1 in 12 men
// cannot separate them at chip size. So the code is always set in mono, and the
// non-commercial chip carries a heavier (2px) border.

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
