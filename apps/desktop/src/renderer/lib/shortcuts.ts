// The one place every keyboard shortcut is written down (ticket 18). The
// shortcut-reference dialog renders straight from this, so "discoverable from
// within the app" and "consistent across search, Library and Collection views"
// are the same fact: a key that behaves differently per view would need two
// rows here, and it does not.

export interface Shortcut {
  /** Display form of the key(s), e.g. `Space`, `Ctrl ↓`, `J`. */
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
      { keys: '/', description: 'Jump to the search box' },
      { keys: 'Esc', description: 'Leave the search box · close a dialog' },
    ],
  },
  {
    title: 'Result list',
    note: 'Search, Library and Collection lists all respond to these identically.',
    items: [
      { keys: '↑ / ↓', description: 'Move the selection' },
      { keys: 'Space', description: 'Play / pause the selected sound' },
      { keys: 'J / Ctrl ↓', description: 'Select and play the next sound' },
      { keys: 'K / Ctrl ↑', description: 'Select and play the previous sound' },
      { keys: 'S', description: 'Save the selected sound to your Library' },
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
