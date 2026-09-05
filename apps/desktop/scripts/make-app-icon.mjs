// Regenerates the packaged-app icon deliverables from the master raster
// `resources/icon-1024.png` (itself rendered from `resources/icon.svg` — see
// that file's header). Ticket 19.
//
//   resources/icon.icns   macOS   (iconutil, so this half is macOS-only)
//   resources/icon.ico     Windows (multi-size, PNG-compressed frames; pure JS)
//
// Both outputs are committed, so a release build never depends on this script
// running — it exists for when the artwork changes. Run:
//
//   pnpm --filter @superduper/desktop icon
//
// Resizing uses `sips` (macOS). On a non-macOS box the script writes nothing and
// exits non-zero; regenerate on a Mac (or the CI macOS runner) and commit.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RES = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')
const MASTER = join(RES, 'icon-1024.png')

if (process.platform !== 'darwin') {
  console.error('make-app-icon: needs macOS (sips + iconutil). Nothing written.')
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'sds-icon-'))
const resize = (size, out) =>
  execFileSync('sips', ['-s', 'format', 'png', '-z', String(size), String(size), MASTER, '--out', out], {
    stdio: 'ignore',
  })

try {
  // ---- .icns -------------------------------------------------------------
  // iconutil wants an `.iconset` dir with Apple's exact names (1x + @2x).
  const iconset = join(work, 'icon.iconset')
  execFileSync('mkdir', ['-p', iconset])
  const icnsSpec = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ]
  for (const [size, name] of icnsSpec) resize(size, join(iconset, name))
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(RES, 'icon.icns')], {
    stdio: 'ignore',
  })

  // ---- .ico ------------------------------------------------------------
  // Vista+ ICO: each frame is a whole PNG. Sizes Windows actually asks for.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const frames = icoSizes.map((size) => {
    const out = join(work, `f${size}.png`)
    resize(size, out)
    return { size, data: readFileSync(out) }
  })

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(frames.length, 4)

  const dir = Buffer.alloc(16 * frames.length)
  let offset = 6 + dir.length
  frames.forEach((f, i) => {
    const e = i * 16
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, e + 0) // width  (0 => 256)
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, e + 1) // height
    dir.writeUInt8(0, e + 2) // palette
    dir.writeUInt8(0, e + 3) // reserved
    dir.writeUInt16LE(1, e + 4) // colour planes
    dir.writeUInt16LE(32, e + 6) // bits per pixel
    dir.writeUInt32LE(f.data.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += f.data.length
  })

  writeFileSync(
    join(RES, 'icon.ico'),
    Buffer.concat([header, dir, ...frames.map((f) => f.data)]),
  )

  console.log(
    `wrote ${join(RES, 'icon.icns')} and ${join(RES, 'icon.ico')} ` +
      `(${frames.length} frames: ${icoSizes.join(', ')})`,
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}
