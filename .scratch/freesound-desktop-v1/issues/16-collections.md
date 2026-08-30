# 16 — Collections

**What to build:** A sound designer keeps one project's material together, without that
filing being destructive or exclusive. A good rain recording can be in both "Weather" and
"Client — Ferry Ad" at the same time.

A [Collection](../../../CONTEXT.md) is a user-named, unordered set of
[Library](../../../CONTEXT.md) sounds. Collections do not nest and do not own their
members. A Collection is not a folder and has no existence on disk — it lives entirely in
the database, per [ADR-0002](../../../docs/adr/0002-database-is-the-truth.md).

Filing must be cheap enough that it actually happens. If adding to a Collection is a
separate chore, users will never do it, and ticket 17 will have nothing to point at.

**Blocked by:** 11 — Library: save, view, delete.

**Status:** ready-for-agent

- [ ] A user can create a named Collection.
- [ ] A Sound can be added to a Collection, and can belong to any number of Collections simultaneously.
- [ ] A Sound can be added to a Collection at the moment it is saved, so filing is not a separate step.
- [ ] Several selected Sounds can be added to a Collection in one action.
- [ ] Removing a Sound from a Collection leaves it in the Library and in any other Collections it belongs to.
- [ ] Collections can be renamed.
- [ ] Deleting a Collection leaves all its Sounds in the Library untouched, and asks for confirmation.
- [ ] Each Sound shows which Collections it belongs to.
- [ ] Collections are browsable in the same list interface as the Library, with the same playback and drag behaviour.
- [ ] Collections do not nest, and the interface does not imply that they can.
- [ ] Deleting a Sound from the Library removes it from every Collection it belonged to.
- [ ] Collection membership persists across restarts.
- [ ] Tests cover: a Sound can belong to multiple Collections; removing from a Collection preserves Library membership and other Collections; deleting a Collection preserves its Sounds; deleting a Sound clears its memberships; batch add works.
