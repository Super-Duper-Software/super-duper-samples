/** Decoded linear PCM: one Float32Array per channel, samples in [-1, 1]. */
export interface DecodedAudio {
  sampleRate: number
  /** Frame count (samples per channel). */
  length: number
  channelData: Float32Array[]
}

/** Thrown when the bytes are not a container this decoder understands, or are corrupt. */
export class UndecodableAudioError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UndecodableAudioError'
  }
}

const MAX_FRAMES = 2_000_000_000

function ascii(view: DataView, offset: number, len: number): string {
  let s = ''
  for (let i = 0; i < len; i++)
    s += String.fromCharCode(view.getUint8(offset + i))
  return s
}

/**
 * Decode WAV or AIFF/AIFC bytes to linear PCM. Throws `UndecodableAudioError` for
 * anything else (including a truncated or malformed file).
 */
export function decodeAudioBuffer(bytes: Uint8Array): DecodedAudio {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 12) {
    throw new UndecodableAudioError('audio is too short to contain a header')
  }
  const magic = ascii(view, 0, 4)
  if (magic === 'RIFF' || magic === 'RIFX') {
    if (ascii(view, 8, 4) !== 'WAVE') {
      throw new UndecodableAudioError('RIFF container is not WAVE')
    }
    return decodeWav(view, magic === 'RIFX')
  }
  if (magic === 'FORM') {
    const formType = ascii(view, 8, 4)
    if (formType !== 'AIFF' && formType !== 'AIFC') {
      throw new UndecodableAudioError(
        `FORM container is not AIFF (${formType})`,
      )
    }
    return decodeAiff(view)
  }
  throw new UndecodableAudioError(
    `unsupported audio container "${magic}" (only WAV and AIFF are decoded locally)`,
  )
}

function decodeWav(view: DataView, bigEndian: boolean): DecodedAudio {
  const le = !bigEndian
  let fmt:
    | {
        audioFormat: number
        channels: number
        sampleRate: number
        bitsPerSample: number
      }
    | undefined
  let dataOffset = -1
  let dataLength = 0

  let p = 12
  while (p + 8 <= view.byteLength) {
    const id = ascii(view, p, 4)
    const size = view.getUint32(p + 4, le)
    const body = p + 8
    if (id === 'fmt ') {
      let audioFormat = view.getUint16(body, le)
      const channels = view.getUint16(body + 2, le)
      const sampleRate = view.getUint32(body + 4, le)
      const bitsPerSample = view.getUint16(body + 14, le)
      if (audioFormat === 0xfffe && size >= 26) {
        audioFormat = view.getUint16(body + 24, le)
      }
      fmt = { audioFormat, channels, sampleRate, bitsPerSample }
    } else if (id === 'data') {
      dataOffset = body
      dataLength = Math.min(size, view.byteLength - body)
    }
    p = body + size + (size & 1)
  }

  if (!fmt) throw new UndecodableAudioError('WAV has no fmt chunk')
  if (dataOffset < 0) throw new UndecodableAudioError('WAV has no data chunk')
  if (fmt.channels < 1)
    throw new UndecodableAudioError('WAV declares no channels')
  const { audioFormat, channels, sampleRate, bitsPerSample } = fmt
  const isFloat = audioFormat === 3
  const isPcm = audioFormat === 1
  if (!isPcm && !isFloat) {
    throw new UndecodableAudioError(
      `WAV audio format ${audioFormat} is compressed and not decoded locally`,
    )
  }
  const bytesPerSample = bitsPerSample >> 3
  if (bytesPerSample < 1)
    throw new UndecodableAudioError('WAV bit depth is zero')
  const frameSize = bytesPerSample * channels
  const frames = Math.floor(dataLength / frameSize)
  if (frames < 1)
    throw new UndecodableAudioError('WAV data chunk holds no frames')
  if (frames > MAX_FRAMES)
    throw new UndecodableAudioError('WAV frame count is implausible')

  const readSample = pcmSampleReader(bitsPerSample, isFloat, le)
  const channelData = allocChannels(channels, frames)
  for (let f = 0; f < frames; f++) {
    const base = dataOffset + f * frameSize
    for (let c = 0; c < channels; c++) {
      channelData[c]![f] = readSample(view, base + c * bytesPerSample)
    }
  }
  return { sampleRate, length: frames, channelData }
}

function decodeAiff(view: DataView): DecodedAudio {
  let comm:
    | {
        channels: number
        frames: number
        sampleSize: number
        sampleRate: number
      }
    | undefined
  let ssndOffset = -1
  let ssndSize = 0

  let p = 12
  while (p + 8 <= view.byteLength) {
    const id = ascii(view, p, 4)
    const size = view.getUint32(p + 4, false)
    const body = p + 8
    if (id === 'COMM') {
      const channels = view.getUint16(body, false)
      const frames = view.getUint32(body + 2, false)
      const sampleSize = view.getUint16(body + 6, false)
      const sampleRate = readExtendedFloat80(view, body + 8)
      comm = { channels, frames, sampleSize, sampleRate }
    } else if (id === 'SSND') {
      const dataOffsetField = view.getUint32(body, false)
      ssndOffset = body + 8 + dataOffsetField
      ssndSize = Math.min(
        size - 8 - dataOffsetField,
        view.byteLength - ssndOffset,
      )
    }
    p = body + size + (size & 1)
  }

  if (!comm) throw new UndecodableAudioError('AIFF has no COMM chunk')
  if (ssndOffset < 0) throw new UndecodableAudioError('AIFF has no SSND chunk')
  const { channels, sampleSize, sampleRate } = comm
  if (channels < 1) throw new UndecodableAudioError('AIFF declares no channels')
  if (!(sampleRate > 0))
    throw new UndecodableAudioError('AIFF sample rate is invalid')
  const bytesPerSample = Math.ceil(sampleSize / 8)
  if (bytesPerSample < 1 || bytesPerSample > 4) {
    throw new UndecodableAudioError(
      `AIFF sample size ${sampleSize} not decoded locally`,
    )
  }
  const frameSize = bytesPerSample * channels
  const frames = Math.min(comm.frames, Math.floor(ssndSize / frameSize))
  if (frames < 1) throw new UndecodableAudioError('AIFF SSND holds no frames')
  if (frames > MAX_FRAMES)
    throw new UndecodableAudioError('AIFF frame count is implausible')

  const readSample = pcmSampleReader(bytesPerSample * 8, false, false)
  const channelData = allocChannels(channels, frames)
  for (let f = 0; f < frames; f++) {
    const base = ssndOffset + f * frameSize
    for (let c = 0; c < channels; c++) {
      channelData[c]![f] = readSample(view, base + c * bytesPerSample)
    }
  }
  return { sampleRate, length: frames, channelData }
}

/** Decode an 80-bit IEEE 754 extended-precision float (AIFF sample rate). */
function readExtendedFloat80(view: DataView, offset: number): number {
  const sign = view.getUint8(offset) & 0x80 ? -1 : 1
  const exponent =
    ((view.getUint8(offset) & 0x7f) << 8) | view.getUint8(offset + 1)
  const hi = view.getUint32(offset + 2, false)
  const lo = view.getUint32(offset + 6, false)
  if (exponent === 0 && hi === 0 && lo === 0) return 0
  const mantissa = hi * 2 ** 32 + lo
  return sign * mantissa * 2 ** (exponent - 16383 - 63)
}

function allocChannels(channels: number, frames: number): Float32Array[] {
  const out: Float32Array[] = []
  for (let c = 0; c < channels; c++) out.push(new Float32Array(frames))
  return out
}

/**
 * A reader that pulls one sample at a byte offset and returns it normalised to
 * [-1, 1]. `bits` is the storage width; `isFloat` selects IEEE reads.
 */
function pcmSampleReader(
  bits: number,
  isFloat: boolean,
  le: boolean,
): (view: DataView, offset: number) => number {
  if (isFloat) {
    if (bits === 32) return (v, o) => clamp(v.getFloat32(o, le))
    if (bits === 64) return (v, o) => clamp(v.getFloat64(o, le))
    throw new UndecodableAudioError(`float PCM width ${bits} not supported`)
  }
  switch (bits) {
    case 8:
      return (v, o) => (v.getUint8(o) - 128) / 128
    case 16:
      return (v, o) => v.getInt16(o, le) / 32768
    case 24:
      return (v, o) => read24(v, o, le) / 8388608
    case 32:
      return (v, o) => v.getInt32(o, le) / 2147483648
    default:
      throw new UndecodableAudioError(`integer PCM width ${bits} not supported`)
  }
}

function read24(view: DataView, offset: number, le: boolean): number {
  const b0 = view.getUint8(offset)
  const b1 = view.getUint8(offset + 1)
  const b2 = view.getUint8(offset + 2)
  const unsigned = le
    ? b0 | (b1 << 8) | (b2 << 16)
    : (b0 << 16) | (b1 << 8) | b2
  return unsigned & 0x800000 ? unsigned - 0x1000000 : unsigned
}

function clamp(n: number): number {
  if (Number.isNaN(n)) return 0
  return n < -1 ? -1 : n > 1 ? 1 : n
}
