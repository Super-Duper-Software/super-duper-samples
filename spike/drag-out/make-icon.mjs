// Throwaway spike (ticket 01). Writes asset/icon.png — a real, valid 64x64 PNG.
//
// The previous inline base64 "PNG" decoded to a 0x0 empty image under Electron's
// nativeImage (Chromium rejects it), which made startDrag() bail on macOS and
// meant the spike never actually exercised drag-out. This encodes a proper PNG:
// IHDR + zlib-deflated IDAT + IEND, with correct CRC32s.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "asset", "icon.png");

const SIZE = 64;

// --- build raw RGBA pixels: a filled rounded-ish square, Freesound-ish orange ---
const bytesPerPixel = 4;
const stride = SIZE * bytesPerPixel;
const raw = Buffer.alloc((stride + 1) * SIZE); // +1 filter byte per scanline

for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (stride + 1);
  raw[rowStart] = 0; // filter type 0 (None)
  for (let x = 0; x < SIZE; x++) {
    const p = rowStart + 1 + x * bytesPerPixel;
    // simple 6px inset border radius feel: transparent corners
    const inset = 3;
    const near =
      (x < inset || x >= SIZE - inset || y < inset || y >= SIZE - inset) &&
      // knock out the very corners
      Math.hypot(
        Math.min(x, SIZE - 1 - x) - inset,
        Math.min(y, SIZE - 1 - y) - inset,
      ) > 4;
    if (near) {
      raw[p] = 0;
      raw[p + 1] = 0;
      raw[p + 2] = 0;
      raw[p + 3] = 0;
    } else {
      raw[p] = 0xf5; // R
      raw[p + 1] = 0x7a; // G
      raw[p + 2] = 0x00; // B
      raw[p + 3] = 0xff; // A
    }
  }
}

// --- PNG plumbing ---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); // width
ihdr.writeUInt32BE(SIZE, 4); // height
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk("IHDR", ihdr),
  chunk("IDAT", idat),
  chunk("IEND", Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);

// --- verify it round-trips as a real raster ---
const back = fs.readFileSync(OUT);
const okSig = back.slice(0, 8).equals(sig);
const w = back.readUInt32BE(16);
const h = back.readUInt32BE(20);
console.log(
  `wrote ${OUT} — ${back.length} bytes, sig ok: ${okSig}, IHDR ${w}x${h}, ` +
    `bitdepth ${back[24]}, colortype ${back[25]}`,
);
if (!okSig || w !== SIZE || h !== SIZE) {
  console.error("icon PNG failed self-check");
  process.exit(1);
}
