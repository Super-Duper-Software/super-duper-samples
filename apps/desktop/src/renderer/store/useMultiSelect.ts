// A minimal checkbox multi-selection for the Library / Collection list views
// (ticket 16). Its only job is to gather several Sounds so they can be added to
// a Collection in one action. Search rows do not use it.
//
// Kept deliberately tiny: a Set of sound ids plus toggle / clear. A row
// subscribes through `selectRowChecked(id)` + `useShallow` so only the toggled
// row re-renders.

import { create } from 'zustand'

export interface MultiSelectState {
  checked: Set<number>
  toggle: (soundId: number) => void
  set: (soundId: number, on: boolean) => void
  clear: () => void
}

export const useMultiSelect = create<MultiSelectState>((set) => ({
  checked: new Set<number>(),

  toggle: (soundId) =>
    set((s) => {
      const next = new Set(s.checked)
      if (next.has(soundId)) next.delete(soundId)
      else next.add(soundId)
      return { checked: next }
    }),

  set: (soundId, on) =>
    set((s) => {
      if (s.checked.has(soundId) === on) return s
      const next = new Set(s.checked)
      if (on) next.add(soundId)
      else next.delete(soundId)
      return { checked: next }
    }),

  clear: () => set((s) => (s.checked.size === 0 ? s : { checked: new Set() })),
}))

export function selectRowChecked(soundId: number) {
  return (s: MultiSelectState): { checked: boolean } => ({
    checked: s.checked.has(soundId),
  })
}
