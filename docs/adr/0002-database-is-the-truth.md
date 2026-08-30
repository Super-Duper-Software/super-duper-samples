# The database is the truth; the audio folder is a flat content store

Downloaded Originals are written to a flat, app-managed directory named by Freesound
sound id (`442827.wav`), and all organisation — Collections, tags, ratings, history —
lives in SQLite. The alternative was a user-visible folder tree where the filesystem is
authoritative.

We chose the database because a Sound must be able to belong to several Collections at
once, because renaming or moving a file in Finder must not be able to orphan its
metadata, and because we do not want a reconciliation scan on every launch.

## Consequences

The audio directory is opaque to the user. "Where are my files?" has no satisfying
answer, and backing up the audio folder alone does not back up the Library.

To stop the SQLite file from being a single point of total loss, every downloaded
Original is accompanied by a sidecar `<id>.json` carrying its Freesound metadata,
License and author. The Library can therefore always be rebuilt from the directory
alone. **This sidecar is not optional** — it is the only thing standing between a
corrupt database and an unrecoverable folder of numerically-named audio files.

Because files are named by id, the basename is meaningless to a DAW. On `dragstart` the
file must be hardlinked into a temp directory under a sanitised, human-readable name
derived from the Sound, and *that* path handed to `startDrag`. Dragging the store path
directly would drop a region called `442827.wav` into the user's session.
