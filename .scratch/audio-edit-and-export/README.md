# Audio Edit and Export — tickets

Eight tracer-bullet tickets derived from [spec 0002](../../docs/specs/0002-audio-edit-and-export.md).
Vocabulary is defined in [CONTEXT.md](../../CONTEXT.md); constraints in
[docs/adr/](../../docs/adr/), in particular
[ADR-0005](../../docs/adr/0005-an-edit-is-a-derived-local-sound.md) (an **Edit** is a
derived local Sound).

Work the **frontier** — any ticket whose blockers are all complete. Take one at a time with
`/implement`, clearing context between tickets.

## Dependency graph

```
01 export as an Edit ──┬── 02 full EditSpec + ffmpeg ── 03 Edit peaks ──┐
                       │                                                 ├── 07 Edit view: waveform + region ── 08 Edit view: export dialog
                       ├── 04 drag an Edit out ──────────────────────────┘
                       │
                       ├── 05 Edits in the Manifest
                       │
                       └── 06 Edits survive rebuild
```

## Ticket index

| # | Ticket | Blocked by |
|---|---|---|
| 01 | Export a Library Sound as an Edit | — |
| 02 | Honour the full EditSpec + real ffmpeg runner | 01 |
| 03 | Computed waveform peaks for an Edit | 02 |
| 04 | Drag an Edit out into a DAW | 01 |
| 05 | Edits in the Attribution Manifest | 01 |
| 06 | Edits survive a Library rebuild from sidecars | 01 |
| 07 | The Edit view — waveform + region select + loop-audition | 03, 04 |
| 08 | The Edit view — export dialog wired to createEdit | 07 |

## Notes

- `ffmpeg-static` packaging / asar-unpacking / macOS signing is **not** here — it belongs
  to v1 ticket 19. Development uses the binary from `node_modules`.
- The `audioRenderRunner` seam is the same shape as `computePeaksRunner` /
  `rebuildRunner`; keep the ffmpeg spawn out of the Electron-free core.
- Renderer tickets (07, 08) carry pure-helper unit tests plus manual GUI verification —
  no component tests, per spec 0001.
