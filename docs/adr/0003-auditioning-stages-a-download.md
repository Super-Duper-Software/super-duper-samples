# Auditioning a sound speculatively downloads its Original

`webContents.startDrag()` requires a file that already exists on disk — Electron exposes
no equivalent of macOS's `NSFilePromiseProvider`, so there is no way to produce a file at
drop time. Taken literally this means a user cannot drag from search results, only from
the Library, which costs an explicit save step on every single sound and is the opposite
of the interaction we are copying.

So pressing play on a search result streams the Preview *and* starts downloading the
Original in the background. By the time the user has listened and reached for the mouse,
the file is on disk and draggable. These Staged files are real Originals that are not in
the Library; an explicit save promotes one, and anything unsaved is LRU-evicted once the
staging area exceeds its budget.

## Consequences

Auditioning has a side effect on the network, on the disk, and on the user's Freesound
account — a staged download is recorded by Freesound as that user having downloaded the
sound, and counts against the 2000/day API budget. A user who auditions a hundred sounds
without saving any has downloaded a hundred files. This is a real cost that a strictly
Library-only model would not incur, and it must be bounded: cap staging concurrency,
cancel in-flight staging when the user moves on quickly, and enforce the eviction budget.

Rejected: dragging the Preview mp3 and swapping in the Original afterwards. The receiving
application copies the file into its project on drop, so the swap arrives too late and
the user silently ships 128kbps audio in finished work. This is the single worst failure
mode available to this app and is forbidden outright.
