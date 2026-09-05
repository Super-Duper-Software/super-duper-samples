import type { DragEvent, RefObject } from 'react'
import type { CollectionRef, Sound } from '../../../core/types'
import type { OverflowMenuItem } from '../OverflowMenu'
import type { StagingStatus } from '../../store/useStaging'

export type RowVariant = 'search' | 'library' | 'collection'

export interface ResultRowProps {
  sound: Sound
  index: number
  selected: boolean
  /** Pixel offset from the top of the scrolled content (from the virtualizer). */
  start: number
  /** Row height in pixels. */
  size: number
  onSelect: (index: number) => void
  /**
   * `'search'` badges Sounds already in the Library and offers save-and-file.
   * `'library'` and `'collection'` show the per-row actions, a multi-select
   * checkbox and Collection badges; they differ only in what "remove" means.
   */
  variant?: RowVariant
  /** Library / collection variants: remove this Sound (the caller confirms if needed). */
  onRemove?: (sound: Sound) => void
  /** Override the remove control's label. */
  removeLabel?: string
  /** Override the remove control's tooltip. */
  removeTitle?: string
  /** Library / collection variants: open the Edit view. Omit to hide the affordance. */
  onEdit?: (sound: Sound) => void
}

/** Everything one row's layouts need. Built once by `useResultRow`. */
export interface RowModel {
  props: ResultRowProps
  variant: RowVariant
  isLibraryVariant: boolean

  displayName: string
  customName: string | null
  customTags: string[]
  isEdit: boolean

  inLibrary: boolean
  showCollections: boolean
  memberOf: CollectionRef[]

  checked: boolean
  toggleChecked: () => void

  stagingStatus: StagingStatus
  isCurrent: boolean
  isPlaying: boolean
  isLoading: boolean
  previewFailed: boolean
  onPlayPause: () => void

  onDownload: () => void
  onDeleteFromLibrary: () => void
  armDelete: boolean
  setArmDelete: (armed: boolean) => void

  renaming: boolean
  renameDraft: string
  setRenameDraft: (v: string) => void
  startRename: () => void
  commitRename: () => void
  cancelRename: () => void

  editingTags: boolean
  setEditingTags: (v: boolean) => void
  addingTag: boolean
  tagDraft: string
  setTagDraft: (v: string) => void
  startAddTag: () => void
  commitAddTag: () => void
  cancelAddTag: () => void
  onRemoveTag: (tag: string) => void

  menuItems: OverflowMenuItem[]
  overflowKey: number
  pickerHostRef: RefObject<HTMLSpanElement | null>
  onPickCollection: (collectionId: number) => void

  handleSelect: () => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  dragNotice: string | null
}
