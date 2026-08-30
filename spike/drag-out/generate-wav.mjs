// Throwaway spike helper: write a valid 16-bit PCM WAV (44.1kHz stereo),
// a few seconds of a tone, to asset/sample.wav.
//
// Run: node generate-wav.mjs

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "asset");
const outFile = join(outDir, "sample.wav");

const SAMPLE_RATE = 44100;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const SECONDS = 3;
const FREQ_LEFT = 440; // A4
const FREQ_RIGHT = 660; // E5-ish, so L/R are audibly different

const totalFrames = SAMPLE_RATE * SECONDS;
const bytesPerSample = BITS_PER_SAMPLE / 8;
const blockAlign = CHANNELS * bytesPerSample;
const byteRate = SAMPLE_RATE * blockAlign;
const dataSize = totalFrames * blockAlign;

const buf = Buffer.alloc(44 + dataSize);

// RIFF header
buf.write("RIFF", 0, "ascii");
buf.writeUInt32LE(36 + dataSize, 4);
buf.write("WAVE", 8, "ascii");

// fmt chunk
buf.write("fmt ", 12, "ascii");
buf.writeUInt32LE(16, 16); // PCM fmt chunk size
buf.writeUInt16LE(1, 20); // audio format = PCM
buf.writeUInt16LE(CHANNELS, 22);
buf.writeUInt32LE(SAMPLE_RATE, 24);
buf.writeUInt32LE(byteRate, 28);
buf.writeUInt16LE(blockAlign, 32);
buf.writeUInt16LE(BITS_PER_SAMPLE, 34);

// data chunk
buf.write("data", 36, "ascii");
buf.writeUInt32LE(dataSize, 40);

const amp = 0.25 * 0x7fff;
let off = 44;
for (let i = 0; i < totalFrames; i++) {
  const t = i / SAMPLE_RATE;
  // simple linear fade in/out to avoid clicks
  const env = Math.min(1, t * 8, (SECONDS - t) * 8);
  const l = Math.round(Math.sin(2 * Math.PI * FREQ_LEFT * t) * amp * env);
  const r = Math.round(Math.sin(2 * Math.PI * FREQ_RIGHT * t) * amp * env);
  buf.writeInt16LE(l, off);
  buf.writeInt16LE(r, off + 2);
  off += 4;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, buf);

// Parse the header back to prove it is a valid WAV.
const check = readFileSync(outFile);
const riff = check.toString("ascii", 0, 4);
const wave = check.toString("ascii", 8, 12);
const fmtId = check.toString("ascii", 12, 16);
const audioFormat = check.readUInt16LE(20);
const channels = check.readUInt16LE(22);
const sampleRate = check.readUInt32LE(24);
const bits = check.readUInt16LE(34);
const dataId = check.toString("ascii", 36, 40);
const parsedDataSize = check.readUInt32LE(40);

const ok =
  riff === "RIFF" &&
  wave === "WAVE" &&
  fmtId === "fmt " &&
  audioFormat === 1 &&
  channels === CHANNELS &&
  sampleRate === SAMPLE_RATE &&
  bits === BITS_PER_SAMPLE &&
  dataId === "data" &&
  parsedDataSize === dataSize &&
  check.length === 44 + dataSize;

console.log("wrote", outFile);
console.log({
  riff,
  wave,
  fmtId,
  audioFormat,
  channels,
  sampleRate,
  bits,
  dataId,
  parsedDataSize,
  fileBytes: check.length,
  expectedBytes: 44 + dataSize,
  durationSeconds: SECONDS,
});
if (!ok) {
  console.error("WAV HEADER INVALID");
  process.exit(1);
}
console.log("WAV header valid: OK");
