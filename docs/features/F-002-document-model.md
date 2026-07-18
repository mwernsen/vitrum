# F-002: Document model, persistence & undo/redo

|                |                 |
| -------------- | --------------- |
| **Phase**      | 0 — Foundations |
| **Status**     | draft           |
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
2. Should Cmd-S silently save in place to the open file (native desktop behavior)
   or always confirm? Proposal: silent save in place, Save-As for copies.
