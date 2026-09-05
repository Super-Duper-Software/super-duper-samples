import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import ffmpegStaticPath from 'ffmpeg-static'

/**
 * The bundled fallback drag icon. In the electron-vite `out/` layout
 * `__dirname` is `out/main`, so the committed `resources/` dir sits two levels
 * up; a packaged build ships it under `process.resourcesPath`.
 */
export function resolveDragIconPath(): string {
  const candidates = [
    join(__dirname, '../../resources/drag-icon.png'),
    process.resourcesPath ? join(process.resourcesPath, 'drag-icon.png') : '',
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!
}

/**
 * `ffmpeg-static` exports a path computed from its own `__dirname`, which in a
 * packaged build sits *inside* `app.asar` — a file, not a directory, so
 * `spawn()` fails with `ENOTDIR`. electron-builder unpacks the binary to
 * `app.asar.unpacked` (see `asarUnpack` in electron-builder.yml); rewrite the
 * path to match. Harmless in dev, where the path contains no `app.asar` segment.
 */
export function resolveFfmpegPath(): string | null {
  if (!ffmpegStaticPath) return null
  const unpacked = ffmpegStaticPath.replace(
    `app.asar${sep}`,
    `app.asar.unpacked${sep}`,
  )
  return existsSync(unpacked) ? unpacked : ffmpegStaticPath
}
