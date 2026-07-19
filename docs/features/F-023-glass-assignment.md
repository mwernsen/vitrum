# F-023: Glass assignment & panel rendering

|                |                          |
| -------------- | ------------------------ |
| **Phase**      | 2 — Stained glass domain |
| **Status**     | done                     |
| **Depends on** | F-020, F-022             |
| **Complexity** | M                        |

## Summary

Painting the window: assign glasses from the catalog to detected pieces and render
the panel in color — the moment the app starts feeling like stained glass design
rather than line drawing. Ends Phase 2 (milestone M2).

## Scope

- **Paint tool**: pick a glass in the palette (F-022), click pieces to assign;
  drag-paint across pieces; Alt-click to eyedrop a piece's glass; paint-all-unassigned.
- Assignments stored as `pieceId → glassId` on the document (commands, undoable);
  pieces with no assignment render as "unassigned" hatching.
- **Piece selection as a first-class mode**: click a piece (not its lines) to select
  it; inspector shows its glass, area, perimeter, piece number placeholder; multi-select
  pieces → bulk assign.
- Rendering: fill each piece with its glass base color modulated by transparency
  class (simple alpha/whiteness model in v1) and texture tag (procedural hatch or the
  swatch image as a fill pattern, clipped to the piece); lead/foil lines render on top
  per F-021. This is the "flat" render — physically-plausible light comes in F-053.
- Because piece IDs are stable (F-020 FR-3), assignments survive edits; when a piece
  is split, both fragments inherit the parent's glass.
- Assignment integrity report: count of unassigned pieces surfaced in the status bar
  (input to F-030's ERC).

### Non-goals

- Realistic refraction/transmission rendering (F-053); print/export appearance (F-041/43);
  per-piece texture rotation/offset (Glass Eye Pro Plus feature — backlog, note in F-053).

## Design

This feature completes the Editor screen of `ui_kits/studio` (F-004): canvas +
glass palette + panes (pieces) list + inspector. The pieces list and piece
inspector follow that screen; unassigned-piece hatching and counts use semantic
status tokens, not ad-hoc colors.

## Functional requirements

- FR-1: Assign, bulk-assign, eyedrop, and unassign all work and are each one undo step.
- FR-2: Editing geometry never silently drops assignments except when a piece truly
  disappears; split/merge inheritance per F-020 FR-3.
- FR-3: Unassigned pieces are visually unmistakable and counted in the status bar.
- FR-4: Rendering with 200 colored pieces incl. texture fills maintains F-003's
  interaction budget.
- FR-5: Colors are identical on screen and in the serialized file after reload.

## Acceptance criteria

- Manual: fully color the acceptance panel in under a couple of minutes using
  drag-paint and bulk assign; reload → identical; heavy geometry rework → assignments
  survive sensibly.
- Tests: assignment commands, split/merge inheritance (drives F-020's matcher through
  its API), unassigned counting.

## Open questions

1. ~~Should glass assignment live on the piece (current design) or as a "region paint"
   that reattaches by point-in-piece lookup?~~ **Resolved (Mathieu, delegated, 2026-07-19):
   piece-id map on the document, keyed by the piece **content id** (F-020) so keys are
   reproducible from geometry and survive reload; F-020's matcher extended with an additive
   lineage return to migrate assignments across splits/merges. Region-paint not chosen — see
   Implementation notes.**

## Implementation notes

_Delivered 2026-07-19 on branch `f-023-glass-assignment`._ All four Q1–Q4 decisions were
delegated to the implementer by Mathieu; the answers below were applied as recommended.

**Assignment model & identity (Q1/Q2).** Assignments live on the document as
`Project.assignments: Record<PieceId, GlassId>` (schema **v4 → v5**, `setGlassAssignments`
command — one self-inverting patch expresses paint / drag-paint / bulk / eyedrop / unassign /
save-normalise, so every gesture is one undo step, FR-1). The key is a piece's **content id**
(`pieceKey = contentId(ring)`), not the matched display id, because the content id is a pure hash
of the geometry and so is reproduced by a cold detection on reload — that is what makes colours
resolve directly after a save/reload (FR-5). F-020's matcher gained an **additive** lineage return
(`matchIdsWithLineage`, `DetectionResult.lineage`, keyed content-id → content-id); no existing
F-020 caller changed. Split/merge inheritance (FR-2) is resolved live through one lineage hop plus
the previous generation's resolved map (pure `resolveGeneration` in `@vitrum/core/pieces`): both
split fragments inherit the parent, a merge inherits the larger contributor. A **save-time
normaliser** (`DocumentController.onBeforeSave`, wired in `AppShell`) materialises every live
piece's effective glass under its current content id and drops assignments whose piece disappeared,
so colours split or reshaped mid-session persist across reload — the standard flow is unit- and
E2E-covered.

**Why not region-paint.** The document already keys numbering (F-040) and cut contours (F-021) off
piece ids; a second, geometric "region paint" identity system would fork that spine. Content-id
keying gives the same reload-robustness region-paint promised (reproducible from geometry) without a
parallel model, so region-paint stays the documented fallback only if id stability proves flaky.

**Live resolution (generation token).** `AssignmentController` (runes) recomputes the effective map
in an `$effect`. Inheritance must resolve against the _previous detection generation_, which must
advance only when geometry actually changes — not on every paint. A **generation token** (the
`DetectionResult` object identity, which only changes when the network changes) gates the advance,
so a paint that re-runs the effect on unchanged geometry still resolves splits from the correct base
(regression-tested in `assignment.svelte.test.ts`).

**Paint / piece-select (Q4).** `PaintController` adds two modes distinct from drawing (F-011) and
segment-editing (F-013): **paint** (click assigns the selected glass, drag paints across pieces as
one undo step, Alt-click eyedrops, "fill unassigned pieces" bulk action) and **select** (point-in-
piece pick, Shift multi-select, inspector bulk-assign / unassign). The canvas routes pointers to the
paint layer before the drawing/edit layers when it is active. Piece hit-testing is point-in-piece
over the flattened rings (smallest containing piece wins, so an island beats its container).

**Glass palette dock (Q3).** The F-022 palette was **promoted out of the inspector into a dedicated
left dock** (`GlassDock`, landmark "Glass"; the palette region keeps its "Glass palette" name).
Selecting a swatch chooses the paint glass and enters paint mode; a **library** swatch is first
imported into the project **by value** (deduped by material) via the existing `upsertGlass` command,
so assignments always reference a self-contained project glass (F-022 FR-1). Editing a swatch moved
to a dedicated edit button (`GlassPalette` gained optional `onSelect`/`selectedId`; without them its
F-022 behaviour is unchanged). The inspector's no-selection view now shows the panel summary,
technique panel and pieces list; a new **piece panel** shows a selected piece's glass, number
placeholder, area and perimeter, plus bulk-assign / unassign.

**Rendering.** `drawGlassFills` fills each piece with its glass base colour dimmed by a simple
per-transparency alpha (transparent 0.5 → opaque 1.0), with a light procedural hatch for textured
glass; unassigned pieces get a sunken base plus a **warning-token** hatch (FR-3) and are counted in
the status bar (`Unassigned: N`, warning colour when > 0 — input to F-030's ERC). The panel render
is on by default behind a new "Glass" status-bar toggle; the F-020 dev overlay ("Pieces") is
untouched. Lead/foil lines (F-021) still draw on top. All chrome/markers use tokens; glass fills are
data-driven and token-exempt per the canvas boundary rule.

**Technique preservation (Q5).** Assignments are keyed independently of technique, so the F-021
lead⇄foil switch and cut-contour recompute preserve them with no extra work (F-021 FR-4); the
save-normaliser keeps them coherent.

**Deviations / decisions.**

- **Swatch-image texture fills deferred.** v1 renders base colour + transparency + a procedural
  hatch for textured glass; using a glass's uploaded photo swatch as a clipped fill pattern (async
  image loading, jsdom canvas gaps) is a follow-up. Colour + transparency + procedural texture
  satisfy the "flat" render FR.
- **Net-new screens to back-port** to the Claude Design project: the **glass dock** (with the
  selected-glass header and paint actions) and the inspector **piece panel**.
- **`selectedPieces` / effective map** are keyed by content id throughout the UI so paint, render
  and the save-normaliser agree.

**Tests.** Model: `assignmentCommands.test.ts` (FR-1 set/bulk/unassign/undo/mixed-patch invert,
serialize round-trip) and the v4→v5 migration test. Core: `assignment.test.ts` (lineage for
split/merge, `resolveGeneration` for direct / split / merge / multi-hop / reshape / cold-reload FR-5,
`matchIdsWithLineage` relabel parity). UI: `paint.svelte.test.ts` (paint one, drag paints many in
one command, no-glass no-op, eyedrop, fill-unassigned, select + shift multi-select, bulk assign,
mode-switch clears selection), `assignment.svelte.test.ts` (generation-token inheritance + reset),
`GlassPalette.test.ts` (select-for-paint vs edit), `StatusBar.test.ts` (Glass toggle + unassigned
count). E2E: `paint.spec.ts` drives the real app — draw a border, pick a glass from the dock (auto-
imported), paint the piece (`Unassigned: 1 → 0`), then **save and reopen the file** with the colour
intact (FR-5, native dialogs stubbed in-process); `glass.spec.ts` updated for the palette's new dock
location. Full suite green: `lint`, `format:check`, `check`, **524 unit**, **16 E2E**.

**Verified by me:** all five gates from the repo root; the E2E round-trip exercises the real
serialize→deserialize→detect→resolve path proving FR-5 for the standard flow.

**Pending Mathieu (manual, not automatable):**

- The acceptance-criterion **timing/UX check** — fully colour the acceptance panel in under a
  couple of minutes using drag-paint and bulk assign, and a **gallery/visual** pass that the
  coloured panel (transparency dimming, procedural texture, unassigned hatch) reads as stained glass
  and matches the design system.
- **Heavy geometry rework survives sensibly** — reshape/split-heavy editing then reload; in-session
  inheritance and save-normalisation are covered, but the "sensible" bar on aggressive rework is a
  human judgement.

**Follow-ups (out of scope):**

- Swatch-image (photo) texture fills as clipped patterns (deferred above).
- Autosave/recovery does not run the save-time normaliser, so a crash-recovery snapshot taken after
  a mid-session reshape could lose that reshape's colour on recover; explicit save/save-as is
  robust. Wire the normaliser into the autosave path (or persist inheritance eagerly).
- Stale assignment entries for vanished pieces are pruned only at save; a live GC pass is optional.
- Per-piece texture rotation/offset and realistic transmission remain F-053 (noted in scope).
