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
