# 05 — Edits in the Attribution Manifest

**What to build:** When a sound designer ships a [Collection](../../../CONTEXT.md) that
contains an Edit, the [Attribution Manifest](../../../CONTEXT.md) credits it correctly. An
Edit is credited to the **original** author, [License](../../../CONTEXT.md) and Freesound
URL — because that obligation does not go away when the file is trimmed — and the entry is
marked as edited so a reader knows the credited material was modified. A trimmed
non-commercial Sound is still non-commercial and is flagged and listed apart exactly like
its parent.

**Blocked by:** 01 — Export a Library Sound as an Edit.

**Status:** ready-for-agent

- [ ] An Edit added to a Collection appears in that Collection's Manifest.
- [ ] The Edit's Manifest entry shows the parent Sound's author, License name and Freesound URL.
- [ ] The entry carries an unambiguous "edited" marker distinguishing it from an unmodified Sound.
- [ ] The attribution-required vs CC0 split and the non-commercial flag/segregation are decided on the Edit's inherited License, so an Edit lands in the same section as its parent would.
- [ ] The Manifest remains a snapshot — it does not change if the Collection or the Edit changes afterwards.
- [ ] Tests at the core seam cover: a Collection with an Edit produces an entry crediting the parent's author/License/URL with the edited marker; an Edit of a CC-BY-NC Sound is flagged and segregated; the Manifest text is unchanged after the Collection is modified.
