# 17 — Attribution Manifest

**What to build:** A sound designer finishing a project produces the credits it owes,
without reconstructing them from memory three weeks after the fact.

This is the feature that answers the second problem in the spec — that the moment audio
leaves the app, its [License](../../../CONTEXT.md) is severed from it. A tool that makes
acquisition frictionless without this makes users breach licenses faster than they could by
hand.

An [Attribution Manifest](../../../CONTEXT.md) is generated for a
[Collection](../../../CONTEXT.md) and is a **snapshot**, not a live view. It records what
was true when it was generated, because that is what the user pastes into their release
notes — and what they pasted must stay true even if the Collection changes afterwards.

**Blocked by:** 16 — Collections.

**Status:** ready-for-agent

- [ ] A Manifest can be generated for any Collection.
- [ ] Each entry gives the Sound's title, author, License name and Freesound URL — what CC-BY actually requires.
- [ ] Sounds requiring attribution are separated from those that do not, so CC0 material does not pad the credits unnecessarily.
- [ ] Any Sound whose License restricts commercial use is flagged prominently and listed separately.
- [ ] The Manifest can be copied to the clipboard.
- [ ] The Manifest can be saved to a file the user chooses.
- [ ] The generated Manifest is a snapshot and does not change when the Collection is subsequently modified.
- [ ] The Manifest is readable as-is when pasted into a plain-text context such as a video description or a README.
- [ ] Generating a Manifest for an empty Collection produces a clear message rather than an empty document.
- [ ] A License is shown on every surface where a Sound appears — search results, Library, Collections and detail.
- [ ] Non-commercial Sounds carry an unmistakable warning wherever they appear, not only in the Manifest.
- [ ] Tests cover: a Manifest lists every Collection member with author, License and URL; attribution-required and CC0 Sounds are separated; non-commercial Sounds are flagged; the Manifest does not change when the Collection changes afterwards; an empty Collection is handled.
