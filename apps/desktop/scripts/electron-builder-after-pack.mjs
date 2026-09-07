import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  // A Developer ID cert is present: electron-builder will sign (and notarize)
  // the bundle itself. Skip the ad-hoc fallback so it does not fight that.
  if (process.env.CSC_LINK || process.env.CSC_NAME) {
    console.log('afterPack: Developer ID cert present, skipping ad-hoc sign')
    return
  }

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = join(context.appOutDir, appName)

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
