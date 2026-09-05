import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(__dirname, '..', 'resources', 'drag-icon.png')

const SIZE = 64
const BPP = 4
const stride = SIZE * BPP
const raw = Buffer.alloc((stride + 1) * SIZE)

const R = 0x34
const G = 0xd3
const B = 0x99

const BAR_HEIGHTS = [10, 22, 34, 18, 44, 28, 52, 30, 40, 16, 26, 12]
const barCount = BAR_HEIGHTS.length
const gap = 1
const barW = Math.floor((SIZE - gap * (barCount - 1)) / barCount)
const mid = SIZE / 2

function barAt(x) {
  const slot = barW + gap
  const idx = Math.floor(x / slot)
  const within = x - idx * slot
  if (idx < 0 || idx >= barCount || within >= barW) return null
  return BAR_HEIGHTS[idx]
}

for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (stride + 1)
  raw[rowStart] = 0
  for (let x = 0; x < SIZE; x++) {
    const p = rowStart + 1 + x * BPP
    const h = barAt(x)
    const on = h != null && Math.abs(y + 0.5 - mid) <= h / 2
    raw[p] = R
    raw[p + 1] = G
    raw[p + 2] = B
    raw[p + 3] = on ? 0xff : 0x00
  }
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, png)

const back = fs.readFileSync(OUT)
const okSig = back.subarray(0, 8).equals(sig)
const w = back.readUInt32BE(16)
const h = back.readUInt32BE(20)
console.log(
  `wrote ${OUT} — ${back.length} bytes, sig ok: ${okSig}, IHDR ${w}x${h}, ` +
    `bitdepth ${back[24]}, colortype ${back[25]}`,
)
if (!okSig || w !== SIZE || h !== SIZE) {
  console.error('drag-icon PNG failed self-check')
  process.exit(1)
}
