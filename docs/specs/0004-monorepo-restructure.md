# Spec 0004 — Monorepo Restructure and First Package Extraction

Status: ready-for-agent

Vocabulary: see [CONTEXT.md](../../CONTEXT.md). Terms defined there — Sound, Preview,
Original, Staged, Library, Collection, Account, License, Attribution Manifest, Drag-Out —
keep their glossary meanings. This spec is about repository structure and does not add
domain terms. It introduces structural terms used below with these meanings:

- **workspace member** — a directory with its own `package.json` (or `Cargo.toml`) that
  the root tooling builds, tests and versions as a unit.
- **app** — a workspace member that is deployed or shipped to a user: an Electron client,
  a static site, or a Cloudflare Worker.
- **package** — a private, unpublished workspace member consumed only by other members in
  this repo via the `workspace:` protocol.
- **tool** — a workspace member that is neither app nor package: a standalone CLI or a
  Claude skill, kept here for convenience rather than for code sharing.

## Problem Statement

I have one Electron app (Super Duper Samples) and several things I want to build next: a
3D model browser that is structurally almost the same Electron app, a Rust CLI for git
branching, a Claude skill called Super Duper Teacher, and a marketing site that already
exists in its own repo (`super-duper-landing-page`). The model browser will want the same
drag-a-file-out-of-the-window mechanism, the same logging, the same window and build
wiring, and the same visual design language as Samples.

Today every one of those lives in a separate repo, or does not exist yet. If I start the
model browser as its own repo I will copy Samples wholesale and the two will drift —
different Tailwind versions, divergent drag-out bugs, two design token sets, two build
configs to keep in step. There is no shared place to put the parts that genuinely should
be one thing. I also have to context-switch across repos, clone lists and CI configs for
projects that are really one product family.

## Solution

Collapse the work into a single repository, `super-duper-software/super-duper`, laid out
as `apps/`, `packages/`, `tools/`. Super Duper Samples moves in as `apps/samples` with its
internal structure — `core/`, `main/`, `preload/`, `renderer/` — untouched. Its Freesound
OAuth Worker moves in as `apps/token-worker`. The marketing site and its download-tracking
Worker come in as `apps/landing` and `apps/download-worker`.

The parts Samples and the future model browser will genuinely share are lifted into
`packages/`: the logger; the Electron drag-out host adapter and its ref-count registry;
a small set of Electron helpers plus a build-config factory; a set of headless UI
primitives with a Tailwind v4 design-token preset; and a shared tooling-config package.
Extraction is deliberately conservative — only what is provably domain-free today comes
out; everything Freesound-aware stays in `apps/samples`.

The Rust CLI and the Super Duper Teacher skill are scaffolded under `tools/`. pnpm drives
the JavaScript workspace, Turborepo drives its task graph, Cargo drives `tools/`. Packages
are consumed as raw TypeScript source with no build step. CI becomes one Turbo-affected
pipeline plus a Cargo job.

When it is done: `apps/samples` builds, packages and tests exactly as before; its existing
test suite passes with only import-path changes; and a new Electron app can be started
against the extracted packages instead of by copying Samples.

## User Stories

1. As the maintainer, I want one repository containing Samples, the marketing site, the
   Workers, the future model browser, the Rust CLI and the Super Duper Teacher skill, so
   that I clone once and see the whole product family.
2. As the maintainer, I want a top-level `apps/` / `packages/` / `tools/` split, so that
   the role of every directory is obvious at a glance.
3. As the maintainer, I want Super Duper Samples to live at `apps/samples`, so that its
   name matches its siblings (`apps/model-browser`, `apps/landing`).
4. As the maintainer, I want the internal layout of `apps/samples` — `core/`, `main/`,
   `preload/`, `renderer/`, `test/` — to be unchanged by the move, so that the load-bearing
   core/adapter rule and every existing import inside the app keep working.
5. As the maintainer, I want the repository history carried into the new repo rather than
   started fresh, so that `git blame` and `git log` still explain the Samples code.
6. As the maintainer, I want the restructure done with `git mv`, so that history follows
   each file across the move.
7. As the maintainer, I want the Freesound OAuth Worker moved to `apps/token-worker` as a
   peer of the apps, so that it is deployed and versioned on its own.
8. As the maintainer, I want the marketing site imported as `apps/landing` by copying its
   working tree (no history), so that the effort matches its low coupling to the rest.
9. As the maintainer, I want the marketing site's download-tracking Worker imported as
   `apps/download-worker`, so that both Workers sit together under `apps/`.
10. As the maintainer, I want a placeholder `apps/model-browser` only when I actually start
    that app, so that the tree does not carry an empty shell in the meantime.
11. As the maintainer, I want the logger extracted to `packages/logging`, so that every
    app logs the same way.
12. As the maintainer, I want the Electron drag-out host adapter and its ref-count
    registry extracted to `packages/electron-drag-out`, so that any Electron app can drag
    a real file onto a drop target without reimplementing the OS handshake.
13. As the maintainer, I want the Freesound-specific drag logic — resolving ids to Sounds,
    building human-readable Original names, sweeping the drag temp directory — to stay in
    `apps/samples`, so that the package carries no domain knowledge.
14. As the maintainer, I want a `packages/electron-shell` holding a broadcast helper, a
    window-creation helper, a bundled-asset path resolver and an electron-vite config
    factory, so that a new Electron app does not copy that wiring by hand.
15. As the maintainer, I want each app to keep writing its own main-process entrypoint,
    so that `packages/electron-shell` stays a bag of helpers and never becomes a framework
    that hides app startup.
16. As the maintainer, I want `packages/ui` to hold only headless primitives that carry
    no domain knowledge — an overflow menu, its placement hook, a formatting library, and
    a presentational shortcuts dialog — so that the model browser can use them without
    inheriting Freesound concepts.
17. As the maintainer, I want the shortcuts dialog to take its shortcut groups as a prop,
    with the Samples-specific groups staying in `apps/samples`, so that the component is
    reusable and the content is not.
18. As the maintainer, I want `packages/ui` to ship a Tailwind v4 design-token preset and
    base stylesheet, so that every surface in the family shares one visual language.
19. As the maintainer, I want `apps/samples` migrated from Tailwind v3 to Tailwind v4
    before `packages/ui` is wired in, so that there is exactly one Tailwind major across
    the repo and one preset format.
20. As the maintainer, I want a `packages/config` holding the base `tsconfig`, the Tailwind
    preset entry and the shared Vitest setup, so that config is defined once and extended.
21. As the maintainer, I want packages consumed as raw TypeScript source — their `exports`
    pointing at `src/index.ts` — so that there is no per-package build step or watch mode
    during development.
22. As the maintainer, I want a single root `tsc --build` project graph for type-checking,
    so that cross-package type errors are caught without building anything.
23. As the maintainer, I want pnpm workspaces covering `apps/*` and `packages/*`, so that
    inter-member dependencies resolve through the `workspace:` protocol.
24. As the maintainer, I want Turborepo to define the build/test/typecheck task graph over
    the JavaScript members, so that tasks run in dependency order and only for what changed.
25. As the maintainer, I want a Cargo workspace rooted at `tools/Cargo.toml`, so that Rust
    tooling is isolated from the JavaScript workspace and there is no Cargo manifest at the
    repo root.
26. As the maintainer, I want `tools/branch-cli` scaffolded as a greenfield Rust crate, so
    that the git-branching CLI has a home even though its code is not written yet.
27. As the maintainer, I want `tools/super-duper-teacher` scaffolded as a Markdown skill
    directory, so that the skill is version-controlled alongside everything else.
28. As the maintainer, I want CI to be one pipeline that runs Turbo-affected
    typecheck/test/build for JavaScript plus a Cargo job for `tools/`, so that a change to
    one member does not rebuild the world.
29. As the maintainer, I want `pnpm install --frozen-lockfile` at the repo root to resolve
    the whole workspace, so that CI and a fresh clone start from the same state.
30. As the maintainer, I want release workflows to stay per-app and tag-prefixed
    (`samples-v*`, and later `landing-v*`), so that shipping one app does not implicate the
    others.
31. As the maintainer, I want the Samples release workflow updated to publish from the new
    repository, so that installers still build on tag.
32. As the maintainer, I want the download Worker's `GITHUB_OWNER` / `GITHUB_REPO`
    configuration pointed at `super-duper-software/super-duper`, so that download links
    resolve to releases in the new repo.
33. As the maintainer, I want each app and Worker to keep its own `.env` / `.env.example`
    with no root `.env`, so that secrets stay scoped to the member that needs them.
34. As the maintainer, I want Turbo's `env` / `globalEnv` declared for the keys each task
    reads, so that the task cache does not serve a stale build when an env value changes.
35. As the maintainer, I want `CONTEXT.md` and `CONVENTIONS.md` moved into `apps/samples/`,
    so that they are scoped to the app they actually describe.
36. As the maintainer, I want a new short root `README.md` explaining what each top-level
    directory is, so that a newcomer can orient in one screen.
37. As the maintainer, I want a new root `CONVENTIONS.md` covering repo-wide mechanics —
    pnpm/Turbo/Cargo, raw-source package consumption, tag-prefixed releases, and the
    JSDoc-only comment rule — so that per-app conventions do not have to restate them.
38. As the maintainer, I want the JSDoc-only / no-narrative-comment rule to apply
    repo-wide, so that every member reads the same way.
39. As a developer starting the model browser, I want to add `apps/model-browser` and pull
    in `packages/electron-shell`, `packages/electron-drag-out`, `packages/ui`,
    `packages/logging` and `packages/config`, so that I begin with shared foundations
    instead of a copy of Samples.
40. As a developer, I want `apps/samples` to build, type-check, test and package exactly as
    it did before the restructure, so that the move is provably behaviour-preserving.
41. As a developer, I want the existing Samples test suite to pass after the move with only
    import-path edits, so that the `makeTestCore` seam is demonstrably intact.
42. As a developer, I want each extracted package to have its own Vitest suite exercising
    its public entrypoint, so that the package's contract is pinned independently of any
    consumer.
43. As a CI reader, I want a single green check that spans every workspace member, so that
    "the monorepo builds" is one signal.
44. As the maintainer, I want the old `super-duper-samples` and `super-duper-landing-page`
    repositories archived once the move lands, so that there is one source of truth.

## Implementation Decisions

### Repository and topology

- New repository: `super-duper-software/super-duper`. The current Samples repository's
  git history is pushed to it and retained; the landing repository's history is not
  carried (working tree copied under one commit). Both source repositories are archived
  after the move.
- Top-level directories: `apps/`, `packages/`, `tools/`. No `services/`, no top-level
  `skills/`. Workers are apps.
- `apps/` members: `samples` (was the repo root's `apps/desktop`), `token-worker` (was
  `worker/`), `landing` (from `super-duper-landing-page`), `download-worker` (from that
  repo's `worker/`). `apps/model-browser` is added later, not in this spec.
- `packages/` members: `config`, `logging`, `ui`, `electron-shell`, `electron-drag-out`.
- `tools/` members: `branch-cli` (Rust), `super-duper-teacher` (Markdown skill). Cargo
  workspace root is `tools/Cargo.toml`.
- The restructure is performed with `git mv` so history follows each file. `apps/samples`
  keeps its internal `core/` `main/` `preload/` `renderer/` `test/` structure and the
  load-bearing rule from its `CONVENTIONS.md` unchanged.
- npm scope stays `@superduper/*`. `apps/samples` is `@superduper/samples` (renamed from
  `@superduper/desktop`); `@superduper/token-worker` keeps its name.

### Workspace tooling

- pnpm workspace at the repo root; `pnpm-workspace.yaml` lists `apps/*` and `packages/*`.
  The existing `allowBuilds` / `onlyBuiltDependencies` entries for `electron`, `esbuild`,
  `better-sqlite3`, `ffmpeg-static` are preserved.
- Turborepo at the repo root. `turbo.json` defines `build`, `test`, `typecheck` (and
  `pack:*` for Electron apps) with dependency edges so a package's consumers rebuild when
  it changes. `turbo run <task> --filter=...[<base>]` is the affected-selection mechanism
  used locally and in CI.
- Cargo workspace at `tools/Cargo.toml` with one member, `branch-cli`. No Cargo manifest
  at the repo root; `cargo` is never run from the root.
- Package consumption: each package's `package.json` `exports` (and `main`/`types`) point
  at `src/index.ts`. No package has a build step. Consumers are bundlers (electron-vite,
  Astro) that compile TypeScript directly. Type-checking is a single root `tsc --build`
  over a project-reference graph; each member has a `tsconfig.json` extending
  `@superduper/config`.
- Inter-member dependencies use `workspace:*`.

### Package contents

- `packages/logging` — the current `apps/samples/src/core/logging/logger.ts` module and
  its types, moved verbatim. `apps/samples` imports it as `@superduper/logging`. The file
  log sink (`createFileLogSink`) moves with it if it carries no Freesound knowledge;
  otherwise it stays in `apps/samples`.
- `packages/electron-drag-out` — the `DragHost` interface plus its Electron implementation
  (currently `apps/samples/src/main/dragHost.ts` and `src/core/staging/dragHost.ts`), the
  `DragRegistry` ref-count map (`src/core/staging/dragRegistry.ts`), and a generic helper
  that hardlinks a source file into a temp directory under a caller-chosen basename. The
  package speaks only in absolute paths, icon paths and opaque numeric ids. It does NOT
  contain `dragController`, `dragNaming` or `sweepDragDir` — those import `Sound`, the db
  and the content store and remain in `apps/samples` as the domain glue that calls the
  package.
- `packages/electron-shell` — `broadcaster<T>(channel)` (from `apps/samples/src/main/
  broadcast.ts`), a `createWindow(options)` helper (generalised from `src/main/window.ts`),
  a `resolveBundledAsset(...)` helper (generalised from `src/main/paths.ts`), and a
  `defineElectronViteConfig({ extraMainInputs })` factory that returns the electron-vite
  config the apps currently hand-write. Each app still writes its own `src/main/index.ts`
  that constructs its own core/gateway/IPC. The package adds no `createApp`-style
  lifecycle wrapper.
- `packages/ui` — `OverflowMenu`, `useMenuPlacement`, `lib/format`, and `ShortcutsDialog`
  refactored to accept its shortcut groups as a prop. The Samples shortcut-group data
  (`lib/shortcuts.ts` `SHORTCUT_GROUPS`) stays in `apps/samples`. The package also ships a
  Tailwind v4 token preset and a base stylesheet defining the design tokens
  (`--sd-*` custom properties or the v4 `@theme` equivalent). `NotificationHost` is NOT
  extracted in this spec — it depends on the app notification store.
- `packages/config` — `tsconfig.base.json`, the Tailwind preset entry point, and the
  shared Vitest setup file. Members extend these by `workspace:` dependency, not relative
  path.

### Prerequisite: Tailwind v4 on `apps/samples`

- `apps/samples` is migrated from Tailwind v3 to Tailwind v4 (config format, plugin model,
  PostCSS/Vite integration) before `packages/ui` is introduced, so the repo has one
  Tailwind major and `packages/config` ships one preset format. `apps/landing` is already
  on Tailwind v4 and is the reference for the target setup.

### CI and release

- One CI workflow. A JavaScript job runs `pnpm install --frozen-lockfile` then
  `turbo run typecheck test build --filter=...[<base>]`. A separate job runs
  `cargo test` / `cargo build` for `tools/`. The workflow triggers on pull requests and
  pushes to the default branch.
- Release workflows stay per-app and tag-prefixed. The Samples release workflow is updated
  to run from `super-duper-software/super-duper` and to trigger on `samples-v*` tags; its
  matrix (`pack:mac` on macOS, `pack:win` on Windows) and draft-release step are otherwise
  unchanged.
- The download Worker's `vars.GITHUB_OWNER` / `vars.GITHUB_REPO` (currently
  `super-duper-software` / `super-duper-samples`) point at the new repo. Its route and
  Analytics Engine binding are unchanged.

### Environment and secrets

- Each app/Worker keeps its own `.env` and committed `.env.example`. No root `.env`.
- `turbo.json` declares, per task, the env keys that task reads (e.g. `FREESOUND_*` for
  Samples build tasks) via `env` / `globalEnv`, so cache keys track env changes.

### Documentation

- `CONTEXT.md` and `CONVENTIONS.md` move to `apps/samples/`. Their content is unchanged
  except for internal relative links.
- New root `README.md`: a one-screen map of `apps/`, `packages/`, `tools/` and how to run
  common tasks.
- New root `CONVENTIONS.md`: repo-wide mechanics — pnpm + Turbo + Cargo, raw-source
  package consumption and the `tsc --build` graph, `workspace:*` dependencies,
  tag-prefixed per-app releases, per-member `.env`, and the JSDoc-only / no-narrative
  `//` comment rule applied repo-wide. `apps/samples/CONVENTIONS.md` keeps only what is
  specific to that app (the core/adapter rule, the fixed Freesound constants).

## Testing Decisions

- A good test here asserts externally observable behaviour, not structure. For the
  restructure that means: the workspace resolves, every member's task graph runs green,
  and `apps/samples` behaves as it did before. For an extracted package it means: calling
  the package's public entrypoint produces the documented result. Tests never reach into a
  package's internal modules — only its `src/index.ts` surface.
- **`apps/samples` regression (highest seam).** The existing Vitest suite under
  `apps/samples/test/` — which constructs the core in-process through
  `test/helpers` (`makeTestCore`, fakes, scenarios) with real temp SQLite and filesystem —
  must pass after the move and extraction with no changes beyond import-path rewrites
  (e.g. `../core/logging/logger` becomes `@superduper/logging`). The existing
  `core.no-electron.test.ts` guard (core imports no Electron) continues to hold. This
  suite passing is the acceptance gate for the whole spec.
- **Per-package suites (new seams).** Each of `packages/logging`, `packages/ui`,
  `packages/electron-shell`, `packages/electron-drag-out`, `packages/config` gets a
  `packages/<name>/test/` Vitest suite testing its entrypoint:
  - `electron-drag-out`: `DragRegistry` ref-count semantics (begin/end/has/snapshot,
    unknown and already-zero ids) — port the assertions from the current
    `apps/samples/test/drag.test.ts` and `eviction.test.ts` that cover the registry; the
    hardlink helper against a real temp dir; `DragHost` exercised with a fake in place of
    Electron `webContents`, mirroring the existing `RecordingDragHost` approach.
  - `electron-shell`: `broadcaster` fan-out to multiple fake windows; `createWindow`
    option mapping; `resolveBundledAsset` path resolution in dev vs packaged layout.
  - `ui`: `OverflowMenu` / `ShortcutsDialog` with React Testing Library, following the
    renderer tests already in `apps/samples/test/` (`renderer.transport.test.ts`,
    `shell-polish.test.ts`); `format` as plain unit assertions like the current
    `apps/samples/test/` formatting coverage.
  - `logging`: log records emitted for each level; sink receives the expected shape.
  - `config`: a smoke test that the exported `tsconfig` and Vitest setup load.
- **Workspace check (CI).** `pnpm install --frozen-lockfile` resolves; `turbo run
  typecheck test build` is green for every JavaScript member; `cargo test` is green for
  `tools/`. This runs in CI, not as a Vitest test.
- Prior art for all of the above lives in `apps/samples/test/`: in-process core
  construction via `test/helpers`, recorded gateway fixtures, RTL renderer tests, and
  real-temp-instance SQLite/filesystem tests.
- `tools/branch-cli` ships with a trivial passing `cargo test` (the crate is greenfield;
  real behaviour and its tests are a later spec). `tools/super-duper-teacher` has no
  automated tests.

## Out of Scope

- Building the 3D model browser, or adding `apps/model-browser` in any form.
- Writing the git-branching CLI's behaviour; `tools/branch-cli` is a scaffold only.
- Authoring the Super Duper Teacher skill's content; `tools/super-duper-teacher` is a
  scaffold only.
- Extracting `NotificationHost` or the notification store; extracting `dragController` /
  `dragNaming` / `sweepDragDir`; generalising the main-process entrypoint into a
  `createApp` wrapper. These wait for a second real consumer.
- Any change to Samples' runtime behaviour, domain model, database schema, IPC contract,
  or the Freesound integration.
- Publishing any package to a registry.
- Carrying `super-duper-landing-page` git history into the new repo.
- Redesigning CI beyond the single Turbo-affected pipeline plus Cargo job (no remote
  cache, no matrix beyond what release already uses).
- Restructuring `apps/landing`'s internals or upgrading its dependencies beyond what
  importing it requires.

## Further Notes

- Ordering constraints (detail belongs in tickets, but these edges are load-bearing):
  the restructure/move lands first and must leave `apps/samples` green; the Tailwind
  v3→v4 migration on `apps/samples` precedes wiring `packages/ui`; package extractions
  can otherwise proceed independently and in any order; the `apps/landing` +
  `apps/download-worker` import depends only on the restructure; `tools/` scaffolding
  depends only on the Cargo/pnpm workspace existing.
- Extraction philosophy: with no second Electron app in existence yet, the risk is
  extracting the wrong seam. Every candidate in this spec was checked against the current
  code for domain coupling and trimmed to the part that is genuinely Freesound-free.
  Anything ambiguous was left in `apps/samples`.
- `packages/electron-shell` is honestly a bag of helpers plus a config factory, not a
  framework. If the model browser later shows that app startup itself repeats, a
  `createApp` wrapper can be added then, informed by two real call sites.
- The two Workers already use the `@superduper/*` scope and their own `wrangler`
  config; moving them is a directory move plus a `GITHUB_REPO` pointer change, not a
  rewrite.
