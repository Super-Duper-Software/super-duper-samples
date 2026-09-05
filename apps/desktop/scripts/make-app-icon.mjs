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

  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const frames = icoSizes.map((size) => {
    const out = join(work, `f${size}.png`)
    resize(size, out)
    return { size, data: readFileSync(out) }
  })

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)

  const dir = Buffer.alloc(16 * frames.length)
  let offset = 6 + dir.length
  frames.forEach((f, i) => {
    const e = i * 16
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, e + 0)
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, e + 1)
    dir.writeUInt8(0, e + 2)
    dir.writeUInt8(0, e + 3)
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
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
