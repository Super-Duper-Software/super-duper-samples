export interface Shortcut {
  /** Display form of the key(s), e.g. `Space`, `↑ / ↓`, `J`. */
  keys: string
  description: string
}

export interface ShortcutGroup {
  title: string
  /** A note shown under the group heading, when the scoping needs saying. */
  note?: string
  items: Shortcut[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Anywhere',
    items: [
      { keys: '?', description: 'Show this shortcut list' },
      { keys: 'Esc', description: 'Return to the search box · close a dialog' },
    ],
  },
  {
    title: 'Result list',
    note: 'Search, Library and Collection lists all respond to these identically.',
    items: [
      { keys: '↑ / ↓', description: 'Move the selection' },
      { keys: 'Space', description: 'Play / pause the selected sound' },
      { keys: 'J', description: 'Select and play the next sound' },
      { keys: 'K', description: 'Select and play the previous sound' },
      {
        keys: 'S',
        description:
          'Download the selected sound’s Original and save it to your Library',
      },
      {
        keys: 'Delete / Backspace',
        description:
          'Remove the selected sound (Library: delete it · Collection: remove from the collection)',
      },
    ],
  },
  {
    title: 'Drag out',
    items: [
      {
        keys: 'Drag a row',
        description:
          'Drag the selected sound’s Original into a DAW, editor or file manager',
      },
    ],
  },
]
