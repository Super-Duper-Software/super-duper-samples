# 13 — Library organisation

**What to build:** A sound designer files [Library](../../../CONTEXT.md) sounds by their own
vocabulary rather than the uploader's, and finds anything they own faster than they could
find something they do not.

The user's own name for a Sound is the name that arrives in the DAW — their naming survives
the [Drag-Out](../../../CONTEXT.md). Renaming never severs the Sound from its Freesound
origin or its [License](../../../CONTEXT.md); attribution stays intact regardless of what
the user calls it.

Library filtering is local and must be instant — it queries the database, never the network.

**Blocked by:** 09 — Real drag-out; 11 — Library: save, view, delete.

**Status:** ready-for-agent

- [ ] A Library Sound can be given a custom name, without losing its link to the original Sound, its author or its License.
- [ ] The custom name is what appears on the file delivered by a Drag-Out; the Freesound name is used when no custom name is set.
- [ ] Custom names are sanitised for filesystem safety before being used as filenames, and collisions remain disambiguated.
- [ ] A user can add and remove their own tags on a Library Sound, alongside the tags inherited from Freesound.
- [ ] The user's own tags are visually distinguishable from inherited ones.
- [ ] The Library can be filtered by tag, License, duration and file format, and combinations of these.
- [ ] Library filtering is served from the database with no network request and feels instant.
- [ ] A free-text filter matches against custom name, Freesound name, author and tags.
- [ ] Filter state is clearly visible and easily cleared.
- [ ] Custom names and tags are preserved across app restarts.
- [ ] Tests cover: a custom name flows through to the path handed to `DragHost`; renaming preserves author, License and Freesound linkage; unsafe characters in a custom name are sanitised; filtering by each dimension returns correct results and makes no gateway call.
