// The single subscription a result row makes to auditioning state.
//
// `useShallow` compares the derived `{ isCurrent, status, failed }` object
// field-by-field, so a row only re-renders when one of those three actually
// changes — never on a playhead frame (which never touches the store) and never
// on a volume / loop / auto-advance change (shallow-equal for every row).

import { useShallow } from 'zustand/react/shallow'
import { selectRowTransport, useTransport, type RowTransport } from '../store/useTransport'

export function useRowTransport(soundId: number): RowTransport {
  return useTransport(useShallow(selectRowTransport(soundId)))
}
