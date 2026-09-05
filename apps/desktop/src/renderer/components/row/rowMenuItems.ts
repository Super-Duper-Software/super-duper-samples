import type { Sound } from '../../../core/types'
import type { OverflowMenuItem } from '../OverflowMenu'
import type { StagingStatus } from '../../store/useStaging'
import type { RowVariant } from './types'

export interface RowMenuParams {
  sound: Sound
  variant: RowVariant
  isRail: boolean
  inLibrary: boolean
  checked: boolean
  stagingStatus: StagingStatus
  removeLabel?: string
  onEdit?: (sound: Sound) => void
  onRemove?: (sound: Sound) => void
  onDownload: () => void
  onDeleteFromLibrary: () => void
  onOpenFreesoundPage: () => void
  onRevealInFinder: () => void
  onStartRename: () => void
  onEditTags: () => void
  onToggleChecked: () => void
  onAddToCollection: () => void
}

/**
 * The `⋯` menu for one row. The rail layout folds in every action that the wide
 * layout shows as its own visible control, so nothing becomes unreachable when
 * the window narrows.
 */
export function buildRowMenuItems(p: RowMenuParams): OverflowMenuItem[] {
  const isLibraryVariant = p.variant === 'library' || p.variant === 'collection'

  const addToCollection: OverflowMenuItem = {
    label: 'Add to collection',
    opensNestedPicker: true,
    disabled: !(isLibraryVariant || p.inLibrary),
    onSelect: p.onAddToCollection,
  }
  const openPage: OverflowMenuItem = {
    label: 'Open Freesound page',
    onSelect: p.onOpenFreesoundPage,
  }
  const licenceDetail: OverflowMenuItem = {
    label: `Licence · ${p.sound.license.name}`,
    disabled: true,
    onSelect: () => {},
  }
  const selectToggle: OverflowMenuItem = {
    label: p.checked ? 'Deselect' : 'Select',
    onSelect: p.onToggleChecked,
  }

  if (p.variant === 'search') {
    if (!p.isRail) return [openPage, addToCollection]
    const removeOrGet: OverflowMenuItem = p.inLibrary
      ? {
          label: p.removeLabel ?? 'Remove from Library',
          destructive: true,
          onSelect: p.onDeleteFromLibrary,
        }
      : { label: '⬇ Download', onSelect: p.onDownload }
    return [removeOrGet, addToCollection, openPage, licenceDetail]
  }

  const common: OverflowMenuItem[] = [
    addToCollection,
    { label: 'Edit tags', onSelect: p.onEditTags },
    { label: 'Rename', onSelect: p.onStartRename },
    { label: 'Reveal in Finder', onSelect: p.onRevealInFinder },
    openPage,
  ]
  const editAction: OverflowMenuItem = {
    label: '✂ Edit',
    disabled: p.stagingStatus !== 'ready',
    onSelect: () => p.onEdit?.(p.sound),
  }
  const remove: OverflowMenuItem = {
    label:
      p.removeLabel ??
      (p.variant === 'collection'
        ? 'Remove from collection'
        : 'Remove from Library'),
    destructive: true,
    onSelect: () => p.onRemove?.(p.sound),
  }

  if (!p.isRail) {
    return p.variant === 'collection' ? common : [...common, remove]
  }

  const items: OverflowMenuItem[] = []
  if (p.onEdit) items.push(editAction)
  items.push(remove, ...common, licenceDetail, selectToggle)
  return items
}
