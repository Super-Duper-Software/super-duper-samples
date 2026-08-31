// What a Creative Commons License obliges the user to do — the two questions an
// Attribution Manifest is built around (ticket 17):
//
//   - does this Sound have to be CREDITED?  (everything except CC0)
//   - does this License RESTRICT COMMERCIAL USE?  (the NC family)
//
// Pure string predicates over the short license label `gateway/mapRawSound`
// derives (`CC0`, `CC-BY`, `CC-BY-NC`, `CC-BY-NC-SA`, `CC-BY-SA`, `Sampling+`,
// …). An unrecognised label — `licenseName` fell through and returned the raw
// deed URL — is treated conservatively: credit required, and flagged for
// commercial use, because we cannot prove it is safe.
//
// The renderer keeps its own copy of the NC check in `LicenseChip`
// (`name.includes('NC')`); the two must stay in step.

/** A label we could not map to a known CC license (it is still the deed URL). */
function isUnknownLicense(name: string): boolean {
  return /^https?:\/\//i.test(name)
}

/**
 * Whether using this Sound obliges the user to credit its author. True for every
 * license except CC0 (public-domain dedication), and for anything unrecognised.
 */
export function requiresAttribution(licenseName: string): boolean {
  if (isUnknownLicense(licenseName)) return true
  return licenseName !== 'CC0'
}

/**
 * Whether this License forbids use in commercial (paid) work — the CC
 * NonCommercial family (`CC-BY-NC`, `CC-BY-NC-SA`, `CC-BY-NC-ND`). Anything
 * unrecognised is flagged too: a sound designer delivering paid work should see
 * it rather than discover the problem after delivery.
 */
export function restrictsCommercialUse(licenseName: string): boolean {
  if (isUnknownLicense(licenseName)) return true
  return licenseName.includes('NC')
}
