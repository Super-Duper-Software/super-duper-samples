// electron-builder `afterPack` hook (ticket 19).
//
// On macOS, re-signs the packed .app with an AD-HOC signature
// (`codesign --sign -`). This is deliberate and load-bearing:
//
//   * Apple Silicon will not launch a bundle that has NO signature — it reports
//     it as "damaged" and offers only "Move to Trash". An ad-hoc signature
//     clears that; the user then gets the normal, dismissable Gatekeeper prompt
//     ("Apple could not verify …") which marketing/first-run.md walks through.
//   * electron-builder does not ad-hoc sign when `mac.identity` is null, so we
//     do it here, after the bundle (including native better-sqlite3) is fully
//     assembled and before the DMG is built.
//
// No-op on Windows/Linux and when the packed app is not macOS.

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = join(context.appOutDir, appName)

  // Inside-out is handled by --deep here: acceptable for an ad-hoc,
  // self-distributed build (there is no notarization step that would reject it).
  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
    { stdio: 'inherit' },
  )
  execFileSync('codesign', ['--verify', '--verbose=2', appPath], {
    stdio: 'inherit',
  })
  console.log(`afterPack: ad-hoc signed ${appName}`)
}
