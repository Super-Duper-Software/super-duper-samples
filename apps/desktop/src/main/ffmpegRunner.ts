import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type {
  AudioRenderInput,
  AudioRenderResult,
  AudioRenderRunner,
} from '../core/edits/editService'
import type { EditSpec } from '../core/types'

const CODEC_ARGS_BY_FORMAT: Record<EditSpec['format'], string[]> = {
  wav: ['-c:a', 'pcm_s16le'],
  mp3: ['-c:a', 'libmp3lame', '-q:a', '2'],
  flac: ['-c:a', 'flac'],
  ogg: ['-c:a', 'libvorbis', '-q:a', '5'],
}

const MUXER_BY_FORMAT: Record<EditSpec['format'], string> = {
  wav: 'wav',
  mp3: 'mp3',
  flac: 'flac',
  ogg: 'ogg',
}

function abortError(): Error {
  const e = new Error('The export was cancelled.')
  e.name = 'AbortError'
  return e
}

/** Parses ffmpeg's `Duration: HH:MM:SS.ss` banner line for the input file. */
function parseInputDuration(line: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/** Parses one `-progress pipe:1` `out_time=HH:MM:SS.ffffff` line. */
function parseOutTime(line: string): number | null {
  const m = /^out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function buildArgs(input: AudioRenderInput): string[] {
  const { sourcePath, spec, outPath, metadata } = input
  const args = ['-y', '-i', sourcePath]

  if (spec.trim) {
    args.push('-ss', String(spec.trim.startSec), '-to', String(spec.trim.endSec))
  }

  const inputExt = extname(sourcePath).slice(1).toLowerCase()
  const isPlainCopy =
    !spec.trim && !spec.sampleRate && !spec.channels && !spec.normalize && inputExt === spec.format

  if (isPlainCopy) {
    args.push('-c:a', 'copy')
  } else {
    args.push(...CODEC_ARGS_BY_FORMAT[spec.format])
    if (spec.sampleRate) args.push('-ar', String(spec.sampleRate))
    if (spec.channels) args.push('-ac', String(spec.channels))
    if (spec.normalize) args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11')
  }

  args.push(
    '-map_metadata',
    '-1',
    '-metadata',
    `title=${metadata.title}`,
    '-metadata',
    `artist=${metadata.author}`,
    '-metadata',
    `comment=License: ${metadata.licenseUrl}`,
    '-nostats',
    '-progress',
    'pipe:1',
    '-f',
    MUXER_BY_FORMAT[spec.format],
    outPath,
  )

  return args
}

/** Builds the production `AudioRenderRunner` over one `ffmpeg-static` binary path. */
export function createFfmpegAudioRenderRunner(ffmpegPath: string): AudioRenderRunner {
  return function run(input: AudioRenderInput): Promise<AudioRenderResult> {
    const { spec, outPath, signal, onProgress } = input

    if (signal.aborted) return Promise.reject(abortError())

    const expectedDurationSec = spec.trim ? spec.trim.endSec - spec.trim.startSec : null

    return new Promise<AudioRenderResult>((resolve, reject) => {
      const child = spawn(ffmpegPath, buildArgs(input), { stdio: ['ignore', 'pipe', 'pipe'] })

      let settled = false
      let inputDurationSec: number | null = null
      let stderrTail = ''
      let stdoutBuf = ''

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        fn()
      }

      const onAbort = () => child.kill('SIGKILL')
      signal.addEventListener('abort', onAbort, { once: true })

      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        stderrTail = (stderrTail + chunk).slice(-4000)
        if (inputDurationSec === null) {
          const d = parseInputDuration(chunk)
          if (d !== null) inputDurationSec = d
        }
      })

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        stdoutBuf += chunk
        const lines = stdoutBuf.split('\n')
        stdoutBuf = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('out_time=')) {
            const t = parseOutTime(line)
            const total = expectedDurationSec ?? inputDurationSec
            if (t !== null && total && total > 0) {
              onProgress?.(Math.min(1, Math.max(0, t / total)))
            }
          } else if (line === 'progress=end') {
            onProgress?.(1)
          }
        }
      })

      child.on('error', (err) => finish(() => reject(err)))

      child.on('close', (code) => {
        finish(() => {
          if (signal.aborted) {
            reject(abortError())
            return
          }
          if (code !== 0) {
            reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail.trim().slice(-500)}`))
            return
          }
          stat(outPath)
            .then((s) =>
              resolve({
                byteSize: s.size,
                durationSec: expectedDurationSec ?? inputDurationSec ?? 0,
              }),
            )
            .catch(reject)
        })
      })
    })
  }
}
