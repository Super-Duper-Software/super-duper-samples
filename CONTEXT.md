# Context

Ubiquitous language for the Super Duper Samples desktop client. This file is a glossary only —
no implementation details, no decisions, no roadmap. Decisions live in `docs/adr/`.

## Sound

A single audio work published on Freesound by its author, identified by a Freesound
sound id. A Sound is metadata plus two distinct audio artifacts: its [Preview](#preview)
and its [Original](#original). A Sound always carries exactly one [License](#license).

A Sound is never "ours" — it belongs to its author and exists on Freesound whether or
not anyone in our app has heard of it.

## Preview

The lossy, transcoded rendition of a [Sound](#sound) that Freesound serves publicly
(mp3/ogg, high and low quality). Streamable, requires no user authentication, and does
not count as a download against the [Account](#account).

A Preview is for auditioning only. It never enters the [Library](#library) and must
never be handed to an external application via a [Drag-Out](#drag-out) — a Preview
reaching a user's timeline is a defect, not a feature.

## Original

The file the author actually uploaded — the real wav/aiff/flac/mp3 at its native format,
bit depth and sample rate. Retrieving an Original requires an OAuth2 access token, is
performed as the signed-in user, and is recorded by Freesound as that user's download.

The Original is the only artifact that may be dragged into another program.

## Library

The set of [Sounds](#sound) whose [Originals](#original) this user has saved to this
device, together with the local organisation the user has imposed on them.

The Library is *local and per-device*. It is not a Freesound-side concept and does not
correspond to Freesound bookmarks or packs. Two devices signed in to the same
[Account](#account) have two different Libraries.

Library membership is a statement of *intent*, not of disk presence: a
[Staged](#staged) sound is equally on disk but is not in the Library. Sounds enter the
Library only by an explicit user act ("save"), which promotes a Staged sound.

## Staged

An [Original](#original) that has been downloaded speculatively — because the user
auditioned the Sound — but that the user has not chosen to keep. Staged sounds are on
disk and are fully draggable, but they are not part of the [Library](#library), cannot
belong to a [Collection](#collection), and are evicted without warning once the staging
area exceeds its size budget.

Staging is invisible when it works. The user never manages it, is never asked about it,
and is never told a Staged sound was evicted — from their point of view a sound they
auditioned is simply draggable, and one they saved is simply kept.

A Staged sound and a Library sound are the same bytes; only the user's intent differs.

The Library has no inherent structure. All structure is imposed by
[Collections](#collection) and tags.

## Collection

A user-named, unordered set of [Library](#library) sounds. A Sound may belong to any
number of Collections, or to none; Collections do not nest and do not own their members.
Removing a Sound from a Collection does not remove it from the Library.

A Collection is the unit an [Attribution Manifest](#attribution-manifest) is generated
for — it is how a user says "these are the sounds in this piece of work".

A Collection is not a folder. It has no existence on disk.

## Attribution Manifest

A generated, human-readable credits document listing every [Sound](#sound) in a
[Collection](#collection) with its author, [License](#license) and Freesound URL, and
flagging any Sound whose License restricts the use the user intends.

The Manifest is a snapshot, not a live view: it records what was true when it was
generated, because that is what the user will paste into their release notes.

The user-facing control that generates one is labelled **Credits** in the UI. The
artifact it produces, and the term used everywhere in code and docs, is the
Attribution Manifest.

## Account

The Freesound user identity the app is acting as, established by OAuth2. All
[Originals](#original) are fetched on this Account's behalf and against its download
record. Signing out does not empty the [Library](#library) — the files are already on
disk and were legitimately obtained.

## License

The Creative Commons terms under which a [Sound](#sound)'s author released it (CC0,
CC-BY, CC-BY-NC, and legacy Sampling+). The License is a property of the Sound, travels
with it into the [Library](#library), and governs what the user may do with the
[Original](#original) downstream.

License is not a filter or a badge — it is an obligation attached to the audio.

## Drag-Out

The act of dragging a [Library](#library) item from our window and dropping it into a
different application (a DAW, an editor, a file manager). The receiving application is
outside our control and we learn nothing about the outcome: a Drag-Out is
fire-and-forget, and we never know whether the drop landed.

Only an [Original](#original) already present on disk may be dragged out.
