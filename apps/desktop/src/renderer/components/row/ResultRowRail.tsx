import { formatDuration } from '../../lib/format'
import { StagingChip } from '../StagingChip'
import { Waveform } from '../Waveform'
import { RowMenu, RowName, RowPlayButton, RowTags } from './RowParts'
import type { RowModel } from './types'

/**
 * The narrow layout: two lines per row. Every action the wide layout shows as
 * its own control lives in the `⋯` menu here, so nothing is lost.
 */
export function ResultRowRail({ row }: { row: RowModel }) {
  const { props, variant, isLibraryVariant, inLibrary, stagingStatus } = row
  const { sound } = props
  const isNonCommercial = sound.license.name.includes('NC')

  const stateToken = isNonCommercial ? (
    <span
      role="alert"
      className="shrink-0 whitespace-nowrap rounded border-2 border-license-caution bg-surface-raised px-1 text-[10px] font-bold uppercase tracking-wide text-license-caution"
      title="Non-commercial license — this Sound may not be used in paid work"
    >
      ⚠ NC
    </span>
  ) : variant === 'search' && inLibrary ? (
    <span
      className="shrink-0 rounded border border-ok px-1 text-[10px] font-medium uppercase tracking-wide text-ok"
      title="In your Library — the Original is downloaded"
    >
      ✓ Downloaded
    </span>
  ) : (
    <StagingChip status={stagingStatus} />
  )

  return (
    <>
      <div className="flex items-center gap-2">
        <RowPlayButton row={row} size="sm" />
        <RowName
          row={row}
          className="min-w-0 flex-1 truncate text-sm font-medium text-ink"
        />
        <RowMenu row={row} />
      </div>

      <div
        className="flex items-center gap-2 overflow-hidden"
        title={
          sound.tags.length > 0
            ? `Freesound tags: ${sound.tags.join(', ')}`
            : undefined
        }
      >
        <Waveform
          soundId={sound.id}
          url={sound.waveformUrls.m}
          active={row.isCurrent}
          className="h-6 w-16 shrink-0 rounded-sm"
        />
        <span className="shrink-0 text-xs tabular-nums text-ink-muted">
          {formatDuration(sound.duration)}
        </span>
        <span
          className="shrink-0 rounded border border-line px-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint"
          title={`File format: ${sound.type.toUpperCase()}`}
        >
          {sound.type}
        </span>
        {stateToken}
        {isLibraryVariant && <RowTags row={row} inputWidth="w-24" />}
      </div>
    </>
  )
}
