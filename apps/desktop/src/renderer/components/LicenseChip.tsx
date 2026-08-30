// An informational chip showing a Sound's License short name (CONTEXT.md
// § License). It is NOT a filter and NOT a badge of quality — it names an
// obligation attached to the audio. Non-commercial licenses read in amber so a
// commercial user notices them; everything else is quiet on the dark ground.

import { memo } from 'react'

/** Tailwind classes per license family, tuned for the dark theme. */
function chipClasses(name: string): string {
  if (name === 'CC0') return 'border-emerald-700/60 bg-emerald-950/60 text-emerald-300'
  if (name.includes('NC')) return 'border-amber-700/60 bg-amber-950/60 text-amber-300'
  if (name.startsWith('CC-BY')) return 'border-sky-700/60 bg-sky-950/60 text-sky-300'
  if (name === 'Sampling+') return 'border-violet-700/60 bg-violet-950/60 text-violet-300'
  return 'border-neutral-700 bg-neutral-800 text-neutral-300'
}

export const LicenseChip = memo(function LicenseChip({ name }: { name: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${chipClasses(
        name,
      )}`}
      title={`License: ${name}`}
    >
      {name}
    </span>
  )
})
