# An Edit is a derived local Sound, stored beside the Original it came from

The app lets a user trim and/or re-encode an Original they already hold in the
[Library](../../CONTEXT.md). The result — an **Edit** — is a new audio artifact: its own
bytes, its own format, its own duration, a name the user chose. It is not a Freesound
Sound; it has no Freesound id and was never downloaded from Freesound.

An Edit still carries an obligation. It is a derivative of exactly one parent Sound and
inherits that Sound's [License](../../CONTEXT.md), author and Freesound URL unchanged — the
License is "an obligation attached to the audio" and it travels downstream (CONTEXT.md §
License). A CC-BY Original trimmed to four seconds is still CC-BY and still owes credit to
the same person.

Rather than a parallel `edits` table and parallel code paths through the Library,
Collections, Drag-Out, computed peaks and the Attribution Manifest, an Edit is represented
as a row in `sounds` with a **negative `id`** (Freesound ids are always positive, so the
two id spaces cannot collide) and three added nullable columns: the parent Sound's id, the
edit spec (trim window plus encode settings, as JSON), and the absolute path to the Edit's
file. Every consumer that already keys on a sound id gets Edits for free.

An Edit's file lives in the same flat content store as Originals (ADR-0002) but under a
name derived from its parent plus a human suffix — `<parentId>-edited.<ext>`,
`<parentId>-edited-2.<ext>`, … — never the `<id>.<ext>` scheme, because a negative id is
not a basename we want on disk. It gets the mandatory sidecar every store file has,
extended with the parent id, the edit spec, and — because an Edit's name is user-chosen and
has no Freesound name to fall back on — the user's chosen name (`customName`), kept in sync
on every rename, so the Library rebuild can reconstruct it under its real name rather than
the bare `edited` placeholder.

The trim + encode itself runs in a bundled `ffmpeg-static` binary invoked from the main
process, behind an injected `audioRenderRunner` seam on `createCore` — the same shape as
the peak Worker and the rebuild Worker. It touches no network, so producing an Edit costs
nothing against the Freesound download quota.

## Consequences

The `sounds` table no longer holds only mirrored Freesound rows. A reader must treat a
negative id (equivalently, a non-null parent-id column) as "this is an Edit: its License
is inherited, and its file is not where the id says". Migration 001's rule that later
migrations "only ever ADD columns or indexes" still holds — this is three nullable columns
and no backfill.

The Attribution Manifest resolves an Edit to its parent for author / License / URL and
marks the entry as edited. An Edit of a non-commercial Sound is still non-commercial and is
flagged and segregated identically to its parent.

Deleting the parent Sound from the Library does not delete its Edits — they are independent
files with their own rows — and an Edit whose parent is gone is still fully attributable
from its own inherited columns and its sidecar.

`ffmpeg-static` adds a per-platform binary (tens of MB) that must be unpacked from the asar
archive and, on macOS, signed with the app bundle. That work belongs to ticket 19
(package / sign / notarize).

Peaks for an Edit are computed from the parent Original sliced to the trim window when the
parent is a container the local decoder reads (WAV / AIFF); otherwise the render step emits
a scratch PCM rendition for the peak Worker. An Edit is never left with no waveform.

Rejected: a separate `edits` table with its own id space and dedicated
list / drag / manifest / rebuild paths. It is the cleaner model on paper but multiplies the
surface area of six existing subsystems for a feature whose whole point is that an Edit
behaves like any other Library item.

Rejected: editing the Original in place. It destroys the user's only local copy
(re-downloading spends quota) and breaks the invariant the peak cache and `decodeAudio`
rely on — "an Original never changes in place". An Edit is always a new file.

Rejected: storing only the edit spec and rendering the file lazily at Drag-Out time.
Electron's `startDrag` needs a real file on disk before the drag begins (ADR-0003), and a
Library item with no bytes until dragged cannot be auditioned, cannot have peaks, and is
absent from a backup of the content folder. An Edit is materialised the moment the user
confirms it.
