import { randomBytes } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { errorMessage } from '../errorMessage'
import type { AudioRenderRunner } from '../edits/editService'
import type { PeakResult, PeakRunner } from './computeFromFile'
import { BASE_BUCKET_COUNT } from './computePeaks'

export interface ScratchPcmMetadata {
  title: string
  author: string
  licenseUrl: string
}

/**
 * Does this render failure mean the source genuinely is not decodable audio (a
 * dead end worth caching a sentinel for), rather than a transient/environmental
 * failure? Keyed off the ffmpeg stderr tail the production runner attaches.
 */
function isNotAudioError(err: unknown): boolean {
  const m = errorMessage(err).toLowerCase()
  return (
    m.includes('invalid data found when processing input') ||
    m.includes('does not contain any stream') ||
    m.includes('could not find codec parameters')
  )
}

/**
 * Render `sourcePath` to a throwaway PCM `.wav` under the OS temp dir, compute
 * peaks from that, then delete it. Used for containers `decodeAudioBuffer`
 * cannot read directly.
 *
 * A failure ffmpeg reports as "this is not audio" comes back `undecodable: true`;
 * any other failure stays `false` so a later request retries instead of
 * poisoning the cache.
 */
export async function computeViaScratchPcm(args: {
  sourcePath: string
  metadata: ScratchPcmMetadata
  render: AudioRenderRunner
  runner: PeakRunner
}): Promise<PeakResult> {
  const scratchPath = join(
    tmpdir(),
    `peaks-scratch-${randomBytes(8).toString('hex')}.wav`,
  )
  try {
    await args.render({
      sourcePath: args.sourcePath,
      spec: { trim: null, format: 'wav' },
      outPath: scratchPath,
      signal: new AbortController().signal,
      metadata: args.metadata,
    })
    return await args.runner(scratchPath, BASE_BUCKET_COUNT, null)
  } catch (err) {
    return {
      ok: false,
      undecodable: isNotAudioError(err),
      error: errorMessage(err),
    }
  } finally {
    await rm(scratchPath, { force: true }).catch(() => {})
  }
}
