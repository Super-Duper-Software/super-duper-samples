# Freesound desktop — v1 tickets

Nineteen tracer-bullet tickets derived from [spec 0001](../../docs/specs/0001-v1.md).
Vocabulary is defined in [CONTEXT.md](../../CONTEXT.md); constraints in
[docs/adr/](../../docs/adr/).

Work the **frontier** — any ticket whose blockers are all complete. Take one at a time with
`/implement`, clearing context between tickets.

## Dependency graph

```
01 drag-out spike ─────────────┐
                               │
02 app skeleton + search ──┬───┼── 03 result rows ──┬── 04 audition ──┐
                           │   │                    │                 │
                           │   │                    └── 05 sqlite ────┼──┐
06 token worker ───────────┴── 07 oauth ─────────────────────────────┤  │
                                                                      │  │
                                        08 staged download ◀──────────┘  │
                                              │                          │
                        ┌─────────────────────┼──────────────┐           │
                        │                     │              │           │
                  09 drag-out ◀── 01     10 sidecars    (15 search ◀─────┘
                        │              + eviction        filters+sort)
                        │                     │
                        └──────┬──────────────┤
                               │              │
                        11 library ───────────┴── 14 rebuild
                               │
        ┌──────────┬───────────┼───────────┬──────────┐
        │          │           │           │          │
   12 peaks   13 library   16 collections  18 shell   │
              organisation      │          polish     │
                   ▲            │                     │
                   └── 09       17 manifest           │
                                                      │
                            19 package/sign/update ◀──┴── (all)
```

## Start immediately

**01**, **02** and **06** have no blockers and can run in parallel.

**01 gates the project.** It is a throwaway spike that answers whether drag-out works at
all on every target platform. If it fails, nothing else here is worth building.

## Milestone

**09 — Real drag-out** is where the product exists. Everything before it is scaffolding for
it; everything after is refinement. A natural point to stop and reassess.

## Open question that can invalidate this backlog

Freesound's rate limits are 60/min and 2000/day, and the documentation does not say whether
they are counted per `client_id` or per user access token. **If per `client_id`, every user
shares one budget and the product cannot work as specified.** Confirm with the Freesound
administrators before starting ticket 07.

## Ticket index

| # | Ticket | Blocked by |
|---|---|---|
| 01 | Drag-out platform spike | — |
| 02 | App skeleton and first search | — |
| 03 | Result rows and virtualized list | 02 |
| 04 | Audition via Preview | 03 |
| 05 | SQLite and search cache | 03 |
| 06 | Token-exchange Worker | — |
| 07 | OAuth sign-in and sign-out | 02, 06 |
| 08 | Staged download on audition | 04, 05, 07 |
| 09 | Real drag-out | 01, 08 |
| 10 | Sidecars and LRU eviction | 08 |
| 11 | Library: save, view, delete | 08, 09 |
| 12 | Computed peaks and canvas waveform | 11 |
| 13 | Library organisation | 09, 11 |
| 14 | Rebuild from sidecars | 10, 11 |
| 15 | Search filters and sort | 05 |
| 16 | Collections | 11 |
| 17 | Attribution Manifest | 16 |
| 18 | Shell polish | 11 |
| 19 | Package, sign, notarize, update | all |
