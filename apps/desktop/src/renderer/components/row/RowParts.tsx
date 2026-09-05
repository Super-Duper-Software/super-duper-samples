import type { KeyboardEvent } from 'react'
import { CollectionMenu } from '../CollectionMenu'
import { OverflowMenu } from '../OverflowMenu'
import type { RowModel } from './types'

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

/** Commit on Enter, abandon on Escape — the convention for every inline field here. */
function inlineFieldKeys(commit: () => void, cancel: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }
}

export function RowPlayButton({
  row,
  size,
}: {
  row: RowModel
  size: 'sm' | 'md'
}) {
  const { props, isCurrent, isPlaying, isLoading, onPlayPause } = row
  return (
    <button
      type="button"
      aria-label={
        isPlaying ? `Pause ${props.sound.name}` : `Play ${props.sound.name}`
      }
      onMouseDown={stop}
      onClick={onPlayPause}
      className={[
        'grid shrink-0 place-items-center rounded-full border',
        size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-7 w-7 text-[11px]',
        isCurrent
          ? 'border-accent-2 text-accent-2-text'
          : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
      ].join(' ')}
    >
      {isLoading ? '…' : isPlaying ? '❚❚' : '▶'}
    </button>
  )
}

/** The Sound's name, swapped for a rename field while the user is editing it. */
export function RowName({ row, className }: { row: RowModel; className: string }) {
  const {
    props,
    renaming,
    renameDraft,
    setRenameDraft,
    commitRename,
    cancelRename,
    customName,
    isEdit,
    displayName,
  } = row

  if (renaming) {
    return (
      <input
        type="text"
        autoFocus
        value={renameDraft}
        onMouseDown={stop}
        onChange={(e) => setRenameDraft(e.target.value)}
        onBlur={commitRename}
        onKeyDown={inlineFieldKeys(commitRename, cancelRename)}
        placeholder="blank = Freesound name"
        className="min-w-0 flex-1 rounded border border-focus bg-surface px-1.5 py-0.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
      />
    )
  }

  return (
    <span
      className={className}
      title={
        customName && !isEdit
          ? `${customName}  (Freesound: ${props.sound.name})`
          : props.sound.name
      }
    >
      {displayName}
    </span>
  )
}

/**
 * The user's own tags. Read-only chips until the row enters tag-edit mode, at
 * which point each chip removes itself and a field appends new ones.
 */
export function RowTags({
  row,
  inputWidth,
}: {
  row: RowModel
  inputWidth: string
}) {
  const {
    customTags,
    editingTags,
    setEditingTags,
    addingTag,
    tagDraft,
    setTagDraft,
    startAddTag,
    commitAddTag,
    cancelAddTag,
    onRemoveTag,
  } = row

  if (!editingTags) {
    if (customTags.length === 0) return null
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {customTags.map((t) => (
          <span
            key={`c:${t}`}
            className="inline-flex shrink-0 items-center rounded border border-ok px-1 text-[10px] text-ok"
            title="Your tag — edit from the ⋯ menu"
          >
            # {t}
          </span>
        ))}
      </span>
    )
  }

  return (
    <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      {customTags.map((t) => (
        <button
          key={`c:${t}`}
          type="button"
          onMouseDown={stop}
          onClick={() => onRemoveTag(t)}
          className="inline-flex shrink-0 items-center gap-0.5 rounded border border-ok px-1 text-[10px] text-ok hover:bg-surface-raised"
          title="Your tag — click to remove"
        >
          <span># {t}</span>
          <span aria-hidden>×</span>
        </button>
      ))}
      {addingTag ? (
        <input
          type="text"
          autoFocus
          value={tagDraft}
          onMouseDown={stop}
          onChange={(e) => setTagDraft(e.target.value)}
          onBlur={commitAddTag}
          onKeyDown={inlineFieldKeys(commitAddTag, cancelAddTag)}
          placeholder="tag + Enter"
          className={`${inputWidth} shrink-0 rounded border border-focus bg-surface px-1 text-[10px] text-ink placeholder:text-ink-faint focus:outline-none`}
        />
      ) : (
        <button
          type="button"
          onMouseDown={stop}
          onClick={startAddTag}
          className="shrink-0 rounded border border-line px-1 text-[10px] text-ink-muted hover:border-line-strong hover:text-ink"
          title="Add your own tag"
        >
          + tag
        </button>
      )}
      <button
        type="button"
        onMouseDown={stop}
        onClick={() => {
          cancelAddTag()
          setEditingTags(false)
        }}
        className="shrink-0 rounded border border-line px-1 text-[10px] text-ink-muted hover:border-line-strong hover:text-ink"
        title="Done editing tags"
      >
        ✓ done
      </button>
    </span>
  )
}

/**
 * The per-row `⋯`. `CollectionMenu` is mounted invisibly alongside it and driven
 * programmatically for the "Add to collection" nested step.
 */
export function RowMenu({ row }: { row: RowModel }) {
  const { menuItems, overflowKey, displayName, pickerHostRef, onPickCollection } =
    row
  return (
    <div className="relative flex shrink-0 items-center">
      <OverflowMenu
        key={overflowKey}
        label={`More actions for ${displayName}`}
        title="More actions"
        items={menuItems}
      />
      <span
        ref={pickerHostRef}
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 opacity-0"
      >
        <CollectionMenu
          label=""
          onPick={onPickCollection}
          title="Add this sound to a collection"
          className="block h-0 w-0 overflow-hidden p-0"
        />
      </span>
    </div>
  )
}
