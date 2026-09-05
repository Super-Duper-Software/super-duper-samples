import { useShallow } from 'zustand/react/shallow'
import { selectRowTransport, useTransport, type RowTransport } from '../store/useTransport'

export function useRowTransport(soundId: number): RowTransport {
  return useTransport(useShallow(selectRowTransport(soundId)))
}
