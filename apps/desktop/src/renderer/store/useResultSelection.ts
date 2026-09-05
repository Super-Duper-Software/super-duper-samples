import { create } from 'zustand'

export interface ResultSelectionState {
  /** Index into the currently loaded result list, or -1 when nothing is selected. */
  selectedIndex: number
  /** Freesound sound id at `selectedIndex`, or null when nothing is selected. */
  selectedId: number | null
  /** Number of rows currently loaded — the upper bound for `move`. */
  count: number

  /** Select an explicit row. Pass `(-1, null)` to clear. */
  select: (index: number, id: number | null) => void
  /**
   * Move the selection by `delta` (e.g. -1 / +1 for Up / Down), clamped to
   * `[0, count - 1]`. `resolveId` maps the new index to a sound id. From an
   * empty selection, a downward move lands on row 0 and an upward move is a
   * no-op.
   */
  move: (delta: number, resolveId: (index: number) => number | null) => void
  /** Tell the store how many rows are loaded (called when results change). */
  setCount: (count: number) => void
  /** Drop the selection (new query, cleared results). */
  clear: () => void
}

export const useResultSelection = create<ResultSelectionState>((set, get) => ({
  selectedIndex: -1,
  selectedId: null,
  count: 0,

  select: (index, id) => set({ selectedIndex: index, selectedId: id }),

  move: (delta, resolveId) => {
    const { selectedIndex, count } = get()
    if (count === 0) return
    const from = selectedIndex < 0 ? (delta > 0 ? -1 : 0) : selectedIndex
    const next = Math.min(count - 1, Math.max(0, from + delta))
    if (next === selectedIndex) return
    set({ selectedIndex: next, selectedId: resolveId(next) })
  },

  setCount: (count) => {
    const { selectedIndex } = get()
    if (selectedIndex >= count) {
      set({ count, selectedIndex: -1, selectedId: null })
    } else {
      set({ count })
    }
  },

  clear: () => set({ selectedIndex: -1, selectedId: null }),
}))
