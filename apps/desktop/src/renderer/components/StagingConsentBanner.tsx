// First-run consent (ticket 08, spec story 52). Before staging takes effect the
// user is told, once, that auditioning downloads sounds against their Freesound
// account's record. Until they click "OK, got it" the core does not stage
// anything; auditioning still streams the Preview.
//
// The flag is persisted in the core (`app_meta.staging_consent_at`); this banner
// only reflects and sets it. It shows only while signed in and not yet granted.

import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'

export function StagingConsentBanner() {
  const { state: auth } = useAuth()
  const signedIn = auth.status === 'signedIn'
  const [granted, setGranted] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    window.core
      .getStagingConsent()
      .then((c) => {
        if (!cancelled) setGranted(c.grantedAt != null)
      })
      .catch(() => {
        if (!cancelled) setGranted(true) // fail closed on the banner, not on staging
      })
    return () => {
      cancelled = true
    }
  }, [signedIn])

  if (!signedIn || granted !== false) return null

  return (
    <div
      role="dialog"
      aria-label="About auditioning and downloads"
      className="flex items-start gap-3 border-b border-amber-800/60 bg-amber-950/40 px-4 py-2 text-xs text-amber-200"
    >
      <p className="flex-1">
        Heads up: auditioning a sound also{' '}
        <strong className="font-semibold">downloads its Original</strong> in the
        background so you can drag it straight out. Each download is recorded
        against your Freesound account and counts toward your daily API limit.
      </p>
      <button
        type="button"
        className="shrink-0 rounded border border-amber-600 px-2 py-1 font-medium text-amber-100 hover:bg-amber-900/60"
        onClick={() => {
          void window.core.grantStagingConsent().finally(() => setGranted(true))
        }}
      >
        OK, got it
      </button>
    </div>
  )
}
