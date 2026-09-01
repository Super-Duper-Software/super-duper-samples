# 03 — Computed waveform peaks for an Edit

**What to build:** An Edit gets its own sharp waveform, so the Edit view (tickets 07–08) and
the row list can draw it the same way they draw a downloaded Original. The waveform matches
the Edit's actual audio — trimmed length, converted or not — and it works even when the
parent Sound's Original is a compressed format the local decoder cannot read.

**Blocked by:** 02 — Honour the full EditSpec + real ffmpeg runner.

**Status:** ready-for-agent

- [ ] `requestPeaks` and `getPeaks` accept an Edit's negative id and return peaks keyed to that id.
- [ ] When the parent Original is a container the local decoder reads (WAV / AIFF), the Edit's peaks are computed from the parent decoded and sliced to the Edit's trim window — no decode of the exported file.
- [ ] When the parent is any other format, the render step emits a scratch PCM rendition that the peak Worker consumes; the scratch file is removed afterwards.
- [ ] An Edit with no trim gets peaks spanning its whole file.
- [ ] Peak computation runs off the main thread through the existing peak runner injection; tests use the in-process runner and never spawn a real Worker.
- [ ] Deleting an Edit removes its peaks row along with its file and Sounds row.
- [ ] Tests at the core seam cover: an Edit created from a WAV parent has peaks whose span matches the trimmed duration; an Edit created from a compressed-source parent still ends up with peaks; deleting the Edit drops the peaks row.
