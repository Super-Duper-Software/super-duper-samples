// Rebuild-from-sidecars offer + result (ticket 14).
//
// The main process pushes `onRebuildOffer` once on startup when the database was
// missing, corrupt or half-migrated but sidecars are on disk. This banner then:
//   - tells the user plainly, BEFORE they accept, that custom names, custom tags
//     and Collections are NOT recoverable;
//   - runs `rebuildFromSidecars()` and shows a progress bar for large libraries;
//   - reports AFTER what was recovered and what could not be — orphan audio
//     (left on disk), orphan sidecars (removed), malformed sidecars — and
//     repeats the "not recoverable" line.
//
// Presentation only: all behaviour is in the core.

import { useEffect, useState } from 'react'
import type { RebuildOffer, RebuildProgress, RebuildReport } from '../../preload'

type Phase =
  | { kind: 'idle' }
  | { kind: 'offered'; offer: RebuildOffer }
  | { kind: 'running'; progress: RebuildProgress | null }
  | { kind: 'done'; report: RebuildReport }
  | { kind: 'failed'; message: string }

export function RebuildBanner() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  useEffect(() => {
    const offOffer = window.core.onRebuildOffer((offer) =>
      setPhase((p) => (p.kind === 'idle' ? { kind: 'offered', offer } : p)),
    )
    const offProgress = window.core.onRebuildProgress((progress) =>
      setPhase((p) => (p.kind === 'running' ? { kind: 'running', progress } : p)),
    )
    return () => {
      offOffer()
      offProgress()
    }
  }, [])

  if (phase.kind === 'idle') return null

  const notRecoverable =
    phase.kind === 'offered'
      ? phase.offer.notRecoverable
      : phase.kind === 'done'
        ? phase.report.notRecoverable
        : ''

  function runRebuild() {
    setPhase({ kind: 'running', progress: null })
    window.core
      .rebuildFromSidecars()
      .then((report) => setPhase({ kind: 'done', report }))
      .catch((err: unknown) =>
        setPhase({
          kind: 'failed',
          message: err instanceof Error ? err.message : String(err),
        }),
      )
  }

  return (
    <div
      role="dialog"
      aria-label="Rebuild your Library from sidecars"
      className="border-b border-warn bg-surface px-4 py-2.5 text-xs text-warn"
    >
      {phase.kind === 'offered' && (
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-1">
            <p>
              <strong className="font-semibold">
                Your library database could not be read.
              </strong>{' '}
              {phase.offer.sidecarCount}{' '}
              {phase.offer.sidecarCount === 1 ? 'sound' : 'sounds'} can be
              rebuilt from the files on disk — with their author and License.
            </p>
            <p className="text-warn">{notRecoverable}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded border border-warn px-2 py-1 font-medium text-warn hover:bg-surface-raised"
            onClick={runRebuild}
          >
            Rebuild Library
          </button>
        </div>
      )}

      {phase.kind === 'running' && (
        <p aria-live="polite">
          Rebuilding your Library…
          {phase.progress && phase.progress.total > 0
            ? ` ${phase.progress.done} / ${phase.progress.total} sidecars`
            : ''}
        </p>
      )}

      {phase.kind === 'failed' && (
        <p role="alert" className="text-error">
          Rebuild failed: {phase.message}
        </p>
      )}

      {phase.kind === 'done' && (
        <div className="flex items-start gap-3">
          <div className="flex-1 space-y-1" aria-live="polite">
            <p>
              <strong className="font-semibold">
                Recovered {phase.report.counts.recovered}{' '}
                {phase.report.counts.recovered === 1 ? 'sound' : 'sounds'}
              </strong>{' '}
              to your Library.
              {phase.report.counts.orphanAudio > 0 &&
                ` ${phase.report.counts.orphanAudio} audio file(s) had no sidecar and were left untouched on disk for you to attribute by hand.`}
              {phase.report.counts.orphanSidecars > 0 &&
                ` ${phase.report.counts.orphanSidecars} stray sidecar(s) had no audio and were removed.`}
              {phase.report.counts.malformed > 0 &&
                ` ${phase.report.counts.malformed} sidecar(s) were unreadable and skipped.`}
            </p>
            <p className="text-warn">{notRecoverable}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded border border-warn px-2 py-1 font-medium text-warn hover:bg-surface-raised"
            onClick={() => setPhase({ kind: 'idle' })}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
