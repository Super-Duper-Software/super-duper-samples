// One result row. Memoized and fed only primitives (plus the stable `sound`
// object and a stable `onSelect`), so a scroll that changes which rows are
// on-screen re-renders only the rows that entered/left — never every row, and
// never on a per-frame cadence.

import { memo, useCallback } from 'react'
import type { Sound } from '../../core/types'
import { formatDuration } from '../lib/format'
import { LicenseChip } from './LicenseChip'
import { Waveform } from './Waveform'

export interface ResultRowProps {
  sound: Sound
  index: number
  selected: boolean
  /** Pixel offset from the top of the scrolled content (from the virtualizer). */
  start: number
  /** Row height in pixels. */
  size: number
  onSelect: (index: number) => void
}

function ResultRowImpl({ sound, index, selected, start, size, onSelect }: ResultRowProps) {
  const handleSelect = useCallback(() => onSelect(index), [onSelect, index])

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-index={index}
      onMouseDown={handleSelect}
      onFocus={handleSelect}
      className={[
        'absolute inset-x-0 flex items-center gap-3 border-b border-neutral-800 px-3',
        'cursor-default select-none outline-none',
        selected
          ? 'bg-neutral-800 ring-1 ring-inset ring-emerald-500'
          : 'hover:bg-neutral-900',
      ].join(' ')}
      style={{ top: 0, height: size, transform: `translateY(${start}px)` }}
    >
      <Waveform
        soundId={sound.id}
        url={sound.waveformUrls.m}
        className="h-9 w-28 shrink-0 rounded-sm"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-neutral-100" title={sound.name}>
            {sound.name}
          </span>
          <span className="shrink-0 text-xs text-neutral-500">{sound.username}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 overflow-hidden">
          <span className="shrink-0 text-xs tabular-nums text-neutral-400">
            {formatDuration(sound.duration)}
          </span>
          <span
            className="min-w-0 flex-1 truncate text-xs text-neutral-500"
            title={sound.tags.join(', ')}
          >
            {sound.tags.join(' · ')}
          </span>
        </div>
      </div>

      <LicenseChip name={sound.license.name} />
    </div>
  )
}

export const ResultRow = memo(ResultRowImpl)
