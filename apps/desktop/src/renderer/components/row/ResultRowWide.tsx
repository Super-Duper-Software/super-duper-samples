import { formatDuration } from '../../lib/format'
import { LicenseChip } from '../LicenseChip'
import { StagingChip } from '../StagingChip'
import { Waveform } from '../Waveform'
import { RowMenu, RowName, RowPlayButton, RowTags } from './RowParts'
import type { RowModel } from './types'

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

/**
 * The search row's download affordance, which doubles as its state readout:
 * downloading → retry → "in your Library" (arming a delete on hover) → download.
 */
function DownloadControl({ row }: { row: RowModel }) {
  const {
    stagingStatus,
    inLibrary,
    armDelete,
    setArmDelete,
    onDownload,
    onDeleteFromLibrary,
  } = row

  if (stagingStatus === 'queued' || stagingStatus === 'downloading') {
    return (
      <span
        className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint"
        title="Downloading this sound's Original from Freesound"
      >
        Downloading…
      </span>
    )
  }

  if (stagingStatus === 'failed' && !inLibrary) {
    return (
      <button
        type="button"
        onMouseDown={stop}
        onClick={onDownload}
        className="shrink-0 rounded border border-error px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-error hover:bg-surface-raised"
        title="The download failed — try again"
      >
        ↻ Retry download
      </button>
    )
  }

  if (inLibrary) {
    return (
      <button
        type="button"
        onMouseDown={stop}
        onMouseEnter={() => setArmDelete(true)}
        onMouseLeave={() => setArmDelete(false)}
        onClick={onDeleteFromLibrary}
        className={[
          'w-[104px] shrink-0 rounded border px-1.5 py-0.5 text-center text-[10px] font-medium uppercase tracking-wide',
          armDelete
            ? 'border-error text-error hover:bg-surface-raised'
            : 'border-ok text-ok',
        ].join(' ')}
        title="In your Library — click to remove it and delete the downloaded Original"
      >
        {armDelete ? 'Delete?' : '✓ Downloaded'}
      </button>
    )
  }

  return (
    <button
      type="button"
      onMouseDown={stop}
      onClick={onDownload}
      className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted hover:border-line-strong hover:text-ink"
      title="Download this sound's Original from Freesound and save it to your Library"
    >
      ⬇ Download
    </button>
  )
}

/** The full-width layout: one line, with the row's actions as visible controls. */
export function ResultRowWide({ row }: { row: RowModel }) {
  const {
    props,
    variant,
    isLibraryVariant,
    customName,
    isEdit,
    displayName,
    checked,
    toggleChecked,
    showCollections,
    memberOf,
    stagingStatus,
    previewFailed,
  } = row
  const { sound, onEdit, onRemove, removeLabel, removeTitle } = props

  return (
    <>
      {isLibraryVariant && (
        <input
          type="checkbox"
          checked={checked}
          onMouseDown={stop}
          onChange={toggleChecked}
          aria-label={`Select ${displayName} for batch actions`}
          className="h-3.5 w-3.5 shrink-0 accent-[var(--sd-accent-2)]"
        />
      )}

      <RowPlayButton row={row} size="md" />

      <Waveform
        soundId={sound.id}
        url={sound.waveformUrls.m}
        active={row.isCurrent}
        className="h-9 w-28 shrink-0 rounded-sm"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <RowName row={row} className="truncate text-sm font-medium text-ink" />
          {isLibraryVariant && customName && !isEdit && (
            <span
              className="shrink-0 truncate text-[11px] italic text-ink-faint"
              title={`Freesound name: ${sound.name}`}
            >
              aka {sound.name}
            </span>
          )}
          <span className="shrink-0 text-xs text-ink-faint">
            {sound.username}
          </span>
        </div>

        <div
          className="mt-0.5 flex items-center gap-2 overflow-hidden"
          title={
            sound.tags.length > 0
              ? `Freesound tags: ${sound.tags.join(', ')}`
              : undefined
          }
        >
          <span className="shrink-0 text-xs tabular-nums text-ink-muted">
            {formatDuration(sound.duration)}
          </span>
          <span
            className="shrink-0 rounded border border-line px-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint"
            title={`File format: ${sound.type.toUpperCase()}`}
          >
            {sound.type}
          </span>
          {previewFailed && (
            <span
              className="shrink-0 rounded border border-error px-1 text-[10px] font-medium uppercase tracking-wide text-error"
              title="This Preview failed to load — try again or pick another sound"
            >
              preview failed
            </span>
          )}
          {isLibraryVariant && <StagingChip status={stagingStatus} />}
          {variant === 'search' && <DownloadControl row={row} />}
          {showCollections &&
            memberOf.map((c) => (
              <span
                key={`col:${c.id}`}
                className="shrink-0 truncate rounded border border-accent-2 px-1 text-[10px] text-accent-2-text"
                title={`In the collection “${c.name}”`}
              >
                {c.name}
              </span>
            ))}
          {isLibraryVariant && <RowTags row={row} inputWidth="w-28" />}
        </div>
      </div>

      {isLibraryVariant && onEdit && (
        <button
          type="button"
          onMouseDown={stop}
          onClick={() => onEdit(sound)}
          disabled={stagingStatus !== 'ready'}
          className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-line-strong hover:text-ink disabled:opacity-40"
          title={
            stagingStatus === 'ready'
              ? 'Open the Edit view — trim a region and audition the cut'
              : "This sound's Original is not on disk yet — it can't be edited"
          }
        >
          ✂ Edit
        </button>
      )}

      {variant === 'collection' && (
        <button
          type="button"
          onMouseDown={stop}
          onClick={() => onRemove?.(sound)}
          className="shrink-0 rounded border border-error px-1.5 py-0.5 text-[11px] text-error hover:bg-surface-raised"
          title={
            removeTitle ??
            'Remove from this collection — the sound stays in your Library'
          }
        >
          {removeLabel ?? 'Remove from collection'}
        </button>
      )}

      <RowMenu row={row} />

      {/* Fixed-width licence slot, always rendered so the controls to its left
          line up from row to row. */}
      <div className="flex w-32 shrink-0 items-center">
        {sound.license.name.includes('NC') ? (
          <span
            role="alert"
            className="block w-full whitespace-nowrap rounded border-2 border-license-caution bg-surface-raised px-1.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide text-license-caution"
            title="Non-commercial license — this Sound may not be used in paid work"
          >
            ⚠ Non-commercial
          </span>
        ) : (
          <LicenseChip name={sound.license.name} className="w-full" />
        )}
      </div>
    </>
  )
}
