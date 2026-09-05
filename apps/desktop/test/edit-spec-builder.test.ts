import { describe, expect, it } from 'vitest'
import {
  buildEditSpec,
  suggestedExportName,
  type ExportDialogState,
} from '../src/renderer/lib/editSpecBuilder'

const BASE_STATE: ExportDialogState = {
  trimToRegion: false,
  format: 'wav',
  normalize: false,
}

describe('buildEditSpec', () => {
  it('produces a whole-file spec when there is no region', () => {
    const spec = buildEditSpec(
      { ...BASE_STATE, trimToRegion: true },
      null,
      120,
    )
    expect(spec.trim).toBeNull()
  })

  it('produces a whole-file spec when the trim toggle is off, even with a region marked', () => {
    const spec = buildEditSpec(
      { ...BASE_STATE, trimToRegion: false },
      { start: 0.25, end: 0.75 },
      100,
    )
    expect(spec.trim).toBeNull()
  })

  it('converts the marked region to seconds when trim is on', () => {
    const spec = buildEditSpec(
      { ...BASE_STATE, trimToRegion: true },
      { start: 0.25, end: 0.75 },
      100,
    )
    expect(spec.trim).toEqual({ startSec: 25, endSec: 75 })
  })

  it('carries the chosen format', () => {
    expect(buildEditSpec({ ...BASE_STATE, format: 'mp3' }, null, 10).format).toBe(
      'mp3',
    )
    expect(buildEditSpec({ ...BASE_STATE, format: 'flac' }, null, 10).format).toBe(
      'flac',
    )
  })

  it('omits sampleRate / channels entirely when left at "same as source"', () => {
    const spec = buildEditSpec(BASE_STATE, null, 10)
    expect(spec).not.toHaveProperty('sampleRate')
    expect(spec).not.toHaveProperty('channels')
  })

  it('carries an explicit sample rate and channel count', () => {
    const spec = buildEditSpec(
      { ...BASE_STATE, sampleRate: 44100, channels: 1 },
      null,
      10,
    )
    expect(spec.sampleRate).toBe(44100)
    expect(spec.channels).toBe(1)
  })

  it('omits normalize when off, includes it as true when on', () => {
    expect(buildEditSpec(BASE_STATE, null, 10)).not.toHaveProperty('normalize')
    expect(
      buildEditSpec({ ...BASE_STATE, normalize: true }, null, 10).normalize,
    ).toBe(true)
  })
})

describe('suggestedExportName', () => {
  it('is "<source name> Edited" for a parent with no existing Edits', () => {
    expect(suggestedExportName('Rain Loop', [])).toBe('Rain Loop Edited')
  })

  it('is "<source name> Edited (2)" once the base name is taken', () => {
    expect(suggestedExportName('Rain Loop', ['Rain Loop Edited'])).toBe(
      'Rain Loop Edited (2)',
    )
  })

  it('skips taken numbers to find the next free slot', () => {
    expect(
      suggestedExportName('Rain Loop', [
        'Rain Loop Edited',
        'Rain Loop Edited (2)',
        'Rain Loop Edited (3)',
      ]),
    ).toBe('Rain Loop Edited (4)')
    expect(
      suggestedExportName('Rain Loop', ['Rain Loop Edited', 'Rain Loop Edited (3)']),
    ).toBe('Rain Loop Edited (2)')
  })

  it('ignores unrelated custom names', () => {
    expect(suggestedExportName('Rain Loop', ['intro riser', 'boom'])).toBe(
      'Rain Loop Edited',
    )
  })
})
