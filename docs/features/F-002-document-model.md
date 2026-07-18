# F-002: Document model, persistence & undo/redo

|                |                 |
| -------------- | --------------- |
| **Phase**      | 0 — Foundations |
| **Status**     | done            |
| **Depends on** | F-001           |
| **Complexity** | L               |

## Summary

The in-memory representation of a stained glass project, the command pattern that is
the _only_ way to mutate it, unlimited undo/redo, and file save/load. This is the
foundation every tool and derived view builds on — the equivalent of the board file
plus edit engine in KiCad. Getting IDs, immutability and the command log right here
prevents a whole class of bugs later.

## User story

As a designer, I want every action to be undoable and my project to be a file I own,
so I can experiment fearlessly and never lose work.

## Core model (v1 entity set)

```
Project
  settings: { units: 'mm' | 'in', name, panelSize? }
  technique: TechniqueSettings        // placeholder until F-021 defines it
  segments: Map<SegmentId, Segment>   // the lead-line network
  glasses:  Map<GlassId, Glass>       // placeholder until F-022
  layers:   ReferenceLayer[]          // placeholder until F-051
Segment
  id: SegmentId (stable, e.g. nanoid — never reused, never index-based)
  geometry: Line | Arc | CubicBezier  // types from packages/geometry (F-010)
  role: 'lead' | 'construction' | 'border'
```

Pieces (closed regions) are **derived**, not stored (F-020) — like ratsnest/nets in
EDA, they are recomputed from the segment network. Only user intent is persisted.

## Scope

- Immutable-update document store in `packages/model` (split from `packages/core`;
  plain TS, no Svelte dependency — `packages/ui` subscribes via a thin adapter).
- Command pattern: every mutation is a `Command { do, undo, merge? }`. Command history
  with unlimited undo/redo; `merge` supports coalescing continuous drags into one entry.
- Serialization to a versioned JSON format (`.vitrum` file, `schemaVersion` field,
  forward-migration hook) — save/load via native file dialogs (Electron main
  process) plus crash-recovery autosave in the app-data directory. Keep the storage
  behind an interface so `pnpm dev:ui` in a plain browser can stub it.
- Dirty-state tracking and unsaved-changes warning.

### Non-goals

- Multi-document/tabs, collaboration, cloud sync (F-055).
- The actual geometry types' math (F-010 — this feature only stores them).
- Any UI beyond wiring undo/redo to menu + Cmd-Z/Cmd-Shift-Z and save/open to menu.

## Functional requirements

- FR-1: All document mutations go through `executeCommand`; direct store writes are
  not exported from the package.
- FR-2: Undo/redo is exact: for any command sequence, undo-all returns a document
  deep-equal to the initial one (property-based test).
- FR-3: Save → load round-trips the document losslessly (property-based test).
- FR-4: Files carry `schemaVersion`; loading a newer version fails with a clear error;
  loading an older version runs registered migrations.
- FR-5: Autosave snapshots to the app-data directory at most every 5 s when dirty; on
  startup after a crash the app offers recovery.
- FR-6: Entity IDs are stable across save/load (references like "piece → glass" in
  later features rely on this).

## Technical guidance

- Consider `immer` for ergonomic immutable updates, or hand-rolled structural sharing;
  avoid heavyweight state frameworks — this package must stay UI-agnostic.
- Keep commands _semantic_ ("AddSegment", "MoveNode") rather than generic patches:
  DRC (F-030) and versioning (F-055) will want to reason about them.
- Store geometry in document units (mm as canonical; inches are a display concern).

## Acceptance criteria

- Property-based tests for FR-2 and FR-3 (e.g. fast-check) in CI.
- Manual: create segments via a debug command palette, undo/redo across 100+ steps,
  save, reload, verify identity.
- Kill the tab mid-edit; reopen; recovery prompt restores the document.

## Open questions

1. File extension `.vitrum` OK? (JSON inside; maybe zip container later for embedded
   reference images — F-051 will force that decision.)
   **Resolved 2026-07-18 (Mathieu): yes, `.vitrum` + versioned JSON now**; revisit a zip
   container when F-051 needs embedded assets.
2. Should Cmd-S silently save in place to the open file (native desktop behavior)
   or always confirm? Proposal: silent save in place, Save-As for copies.
   **Resolved 2026-07-18 (Mathieu): silent save in place**, Save-As (⇧⌘S) for copies.

## Implementation notes

_Delivered 2026-07-18._ Both open questions resolved by Mathieu in session (above).

**New package `packages/model` (`@vitrum/model`)** — pure TS, no Svelte/DOM/Electron;
a `no-restricted-imports` boundary was added to `eslint.config.js` mirroring `core`'s.

- **Document model** (`types.ts`): `Project` = settings + technique + `segments` +
  `glasses` + `layers`. `technique`/`glasses`/`layers` are minimal placeholders for
  F-021/F-022/F-051 so persistence and undo cover them from day one. Geometry is stored
  in mm; `Segment.geometry` is `Line | Arc | CubicBezier` imported from `@vitrum/geometry`.
- **Deviation — record, not `Map`.** `segments`/`glasses` are `Readonly<Record<Id, …>>`
  rather than the spec's `Map<Id, …>`. Records serialize to JSON losslessly (FR-3), do
  structural-sharing updates with a spread, and `toEqual` compares them key-wise. Iteration
  order is insertion order (JSON-preserved); undo re-adds a removed segment at the end, so
  iteration order (but not identity or equality) can differ after undo — acceptable pre-F-003.
- **Command pattern** (`commands.ts`, `store.ts`): every mutation is a semantic `Command`
  with pure `apply` + `invert(before)`; `DocumentStore.execute` is the only mutator (FR-1,
  no raw setters exported). Undo/redo is unlimited and exact — `invert` rebuilds the reverse
  command from the pre-state rather than snapshotting. Drag coalescing (FR): `execute(cmd,
{coalesceKey})` merges consecutive same-key commands into one history entry while keeping
  the earliest inverse, so a drag is a single undo step. Commands: `addSegment`,
  `removeSegment`, `updateSegmentGeometry` (mergeable), `setSegmentRole`, `updateSettings`.
- **Persistence** (`serialize.ts`): `.vitrum` = `{ schemaVersion, project }` JSON.
  `deserialize` rejects newer versions with a clear `SchemaVersionError` (FR-4) and runs
  registered forward migrations for older ones (registry empty at v1; mechanism tested with
  injected migrations). IDs live in the data, so they are stable across save/load (FR-6).
- **Storage & autosave** (`storage.ts`, `autosave.ts`): `StoragePort` interface abstracts
  dialogs/disk; `Autosaver` throttles a recovery snapshot to ≤ once per 5 s while dirty
  (FR-5), timer-injected so it is deterministically testable. It does not mark the document
  saved — a snapshot at startup signals an unclean exit.

**`packages/ui`** — `DocumentController` (`.svelte.ts`) mirrors store state into runes and
owns actions, autosave and the discard guard; `AppHost` abstracts the environment so the UI
stays Electron-free (`browserHost.ts` stub for `pnpm dev:ui`). Undo/redo/save/open are wired
to Cmd-Z/⇧Cmd-Z/Cmd-S/⇧Cmd-S/Cmd-O and to the native menu; Cmd-K opens the debug command
palette (acceptance criteria) built from design-system `Dialog`/`Button`. The TopBar
undo/redo controls are now live and the badge shows Saved/Unsaved. The canvas still shows the
placeholder sample panel — rendering `controller.doc` on the viewport is F-003.

**`apps/desktop`** — Electron main implements `StoragePort` (native open/save dialogs,
`fs`), autosave to `app.getPath('userData')/autosave.vitrum` (overridable via
`VITRUM_AUTOSAVE_PATH` for isolated E2E), a File/Edit application menu (accelerators shown
but `registerAccelerator:false` so the renderer owns the keystroke — no double-fire), a
startup crash-recovery prompt, and an unsaved-changes guard on window close. Preload exposes
an object that structurally satisfies `AppHost`.

**Tests.** Property-based FR-2 (undo-all ≡ initial) and FR-3 (save→load round-trip) via
fast-check; migration/version tests (FR-4); autosave scheduler tests with a fake clock
(FR-5); `DocumentController`/`DebugPalette` component tests; one Playwright E2E driving
create→undo/redo and the dirty badge through the real app. Full suite: 201 unit + 8 E2E green,
plus `lint`/`format:check`/`check`.

**Pending Mathieu (native-dialog flows, not automatable in Playwright):** manual check of
Open/Save/Save-As dialogs and the on-startup crash-recovery prompt. The round-trip and
recovery _logic_ are covered by unit tests; only the native dialog UX is manual.

**Merge coordination — F-010 vendored.** `@vitrum/model` needs `@vitrum/geometry`'s types,
which were in-flight on the `f-010-geometry-kernel` branch and not yet committed. Per
Mathieu, the geometry package was vendored into this branch so the gates run. The vendored
copy also received throwaway fixes to pass this branch's gates (two unused `vec2` imports;
`performance.now()`→`Date.now()` in `intersect.test.ts` for the ES2023-only lib; Prettier
formatting). **At merge, the `f-010-geometry-kernel` version of `packages/geometry` is
canonical** and should overwrite this vendored copy; only `@vitrum/model`'s dependency on it
is load-bearing here.

**Follow-ups (out of scope):** F-003 wires the viewport to render `controller.doc`; the
`New` menu action exists but has no toolbar affordance yet; `TechniqueSettings`/`Glass`/
`ReferenceLayer` are placeholders to be fleshed out by F-021/F-022/F-051.
