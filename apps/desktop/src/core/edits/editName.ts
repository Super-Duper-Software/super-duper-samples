/** The next free Edit name for a parent, given its existing Edits' effective names. */
export function pickEditName(existingNames: readonly string[]): string {
  const taken = new Set(existingNames)
  if (!taken.has('edited')) return 'edited'
  let n = 2
  while (taken.has(`edited (${n})`)) n++
  return `edited (${n})`
}
