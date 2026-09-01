// Pure helper: given the effective names of a parent's existing Edits, pick
// the next free `edited` / `edited (N)` (spec 0002 § Core command API). No I/O
// — the core reads the existing names from the database and hands them here.

/** The next free Edit name for a parent, given its existing Edits' effective names. */
export function pickEditName(existingNames: readonly string[]): string {
  const taken = new Set(existingNames)
  if (!taken.has('edited')) return 'edited'
  let n = 2
  while (taken.has(`edited (${n})`)) n++
  return `edited (${n})`
}
