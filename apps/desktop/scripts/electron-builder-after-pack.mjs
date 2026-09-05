import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

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
