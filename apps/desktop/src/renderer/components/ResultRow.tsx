import { memo } from 'react'
import { useViewport } from '../lib/viewport'
import { ResultRowRail } from './row/ResultRowRail'
import { ResultRowWide } from './row/ResultRowWide'
import { useResultRow } from './row/useResultRow'
import type { ResultRowProps } from './row/types'

export type { ResultRowProps } from './row/types'

function ResultRowImpl(props: ResultRowProps) {
  const { isRail } = useViewport()
  const row = useResultRow(props)
  const { index, selected, start, size } = props

  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-index={index}
      draggable
      onDragStart={row.onDragStart}
      onDragEnd={row.onDragEnd}
      onMouseDown={row.handleSelect}
      onFocus={row.handleSelect}
      className={[
        'absolute inset-x-0 border-b border-line',
        'cursor-default select-none outline-none',
        isRail
          ? 'flex flex-col justify-center gap-1 px-2'
          : 'flex items-center gap-3 px-3',
        selected
          ? 'bg-surface-raised ring-1 ring-inset ring-focus'
          : 'hover:bg-surface',
      ].join(' ')}
      style={{ top: 0, height: size, transform: `translateY(${start}px)` }}
    >
      {isRail ? <ResultRowRail row={row} /> : <ResultRowWide row={row} />}

      {row.dragNotice && (
        <div
          role="alert"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 truncate bg-surface-raised px-3 py-0.5 text-[11px] text-warn"
        >
          {row.dragNotice}
        </div>
      )}
    </div>
  )
}

export const ResultRow = memo(ResultRowImpl)
