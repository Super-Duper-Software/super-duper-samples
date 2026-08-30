# 12 — Computed peaks and canvas waveform

**What to build:** For a [Sound](../../../CONTEXT.md) that is on disk, the waveform becomes
real: sharp at any size, zoomable, scrubbable, with a sample-accurate playhead — rather
than the fixed-resolution image used in search results.

Freesound's API offers no raw peak or sample data, so peaks must be computed locally from
the decoded [Original](../../../CONTEXT.md). This is why the app uses images for browsing
and computed peaks only once a file is present: browsing is exactly when nothing has been
downloaded.

Computation must never block the interface. Saving a long field recording cannot freeze the
app.

**Blocked by:** 11 — Library: save, view, delete.

**Status:** ready-for-agent

- [ ] Peak data is computed from the decoded Original in a worker thread, never on the main or renderer thread.
- [ ] Peaks are computed once per Sound and cached in the database, so revisiting is instant.
- [ ] Sounds on disk render their waveform to canvas from computed peaks, sharp at any width.
- [ ] Search results without a downloaded Original continue to use Freesound's waveform images, with no visual discontinuity when a Sound gains real peaks.
- [ ] The waveform can be zoomed to inspect detail in a long recording.
- [ ] Clicking or dragging on the waveform seeks accurately, including while zoomed.
- [ ] The playhead is sample-accurate against the audio being played.
- [ ] Computing peaks for a long recording leaves the interface fully responsive throughout.
- [ ] A Sound whose audio cannot be decoded falls back to its waveform image rather than rendering nothing or erroring.
- [ ] Cached peaks are removed when a Sound is deleted or evicted.
- [ ] Tests cover: peaks are computed once and reused; peak computation does not block; deletion clears cached peaks; undecodable audio falls back gracefully.
