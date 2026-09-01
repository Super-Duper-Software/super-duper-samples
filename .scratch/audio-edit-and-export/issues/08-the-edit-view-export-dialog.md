# 08 — The Edit view: export dialog wired to createEdit

**What to build:** The Export action in the Edit view. From the marked region (or the whole
file), a sound designer opens a dialog to choose trim-or-not, output format, sample rate,
channels, loudness-normalise and a name (defaulting to `edited`), then commits. Progress
shows for a long render and can be cancelled. When it finishes, the Edit is in the Library
and can be auditioned and dragged out immediately. The marked region survives opening and
adjusting the dialog.

**Blocked by:** 07 — The Edit view: waveform + region select + loop-audition.

**Status:** ready-for-agent

- [ ] An Export control in the Edit view opens a dialog with: trim-to-region toggle, format (WAV / MP3 / FLAC / OGG), sample rate, channels (mono / stereo), normalise, and a name field pre-filled with `edited` / `edited (N)`.
- [ ] Opening or adjusting the dialog does not lose the marked region.
- [ ] Confirming builds an edit spec from the dialog state and calls the create-Edit command; the spec builder is a pure, unit-tested function.
- [ ] A progress indicator reflects `onEditProgress`; a cancel control invokes `cancelEdit` and returns the view to its pre-export state.
- [ ] A render failure surfaces a clear message in the view and leaves no Library entry.
- [ ] On success the dialog closes and the new Edit is present in the Library list without a manual refresh; it can be auditioned and dragged out right away.
- [ ] Exporting with the trim toggle off produces a whole-file Edit; with it on, the Edit's duration matches the region.
- [ ] The edit-spec builder and the `edited` / `edited (N)` name default are covered by unit tests; the dialog flow, progress and cancel are verified by hand and the notes recorded.
