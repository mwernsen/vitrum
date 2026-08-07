# F-050: SVG import

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | done               |
| **Depends on** | F-011, F-020       |
| **Complexity** | L                  |

## Summary

Import SVG files from Illustrator/Inkscape/Affinity and convert paths into editable
lead lines (Diafane parity). Designers often sketch elsewhere; this is the on-ramp.

## User story

As a stained glass designer, I want to bring an SVG I drew in Illustrator or Inkscape
into Vitrum as editable lead lines, so that I can start from an existing sketch instead
of redrawing it, and have piece detection find the regions I drew.

## Scope

- Parse SVG paths (lines, cubic/quadratic béziers, arcs → converted to cubic béziers per
  F-010's decision), apply the full CTM (nested `transform` attributes composed to a
  single matrix per element), map document units.
- **Unit mapping:** honour `width`/`height` with real units against the `viewBox`. When
  only a unitless `viewBox` is present, open the scale dialog defaulting to 1 user-unit =
  1 mm, with a target-width field to rescale the whole artwork proportionally.
- **Import dialog** with a live preview of the parsed + healed network, target scale, and
  options: treat strokes as lead lines, ignore fills, flatten groups.
- **Healing pass** (the hard part): imported art is never a clean network. A single
  tolerance slider (mm) drives it, with live preview of the resulting piece count and a
  highlight of what changed. Healing:
  - snaps near-coincident endpoints together within tolerance,
  - splits intersecting paths at true crossings (reuse F-020's intersection maths),
  - drops zero-length and duplicate segments.
    Report a summary of what was healed. **Healing is idempotent and a no-op at
    tolerance 0 on an already-clean network** (see FR-4). Without healing, piece detection
    yields garbage.
- **Import target:** the healed network merges into the _active_ project as one undo
  step (`patchNetwork` compound command). Import does not create a new document.

### Non-goals

- Raster autotrace (bitmap → vectors). Glass Eye Pro Plus has it; genuinely useful
  with F-051, but a separate hard feature → backlog **F-059** (see ROADMAP's backlog
  table).
- Text-to-path, gradients, clip paths (drop with a notice listing what was ignored).

## Design

New UI: an **Import dialog** modal. No existing design in the Claude Design project, so
design-and-build it in code following the Vitrum Design System, and note it in
Implementation notes for back-port:

- Compose from `components/core` primitives (dialog/modal, slider, checkboxes, number
  field for target scale/width, primary + secondary buttons). Tokens only, no raw hex/px.
- The dialog is reached from the existing import affordance (File menu / TopBar); wire it
  to the placeholder tagged `F-050` if one exists.
- Preview canvas inside the dialog renders the parsed network using the same
  data-driven document rendering as `Canvas.svelte` (glass/lead content is token-exempt);
  the "what was healed" highlight is a canvas overlay and **must** use design tokens.
- Copy: sentence case, no emoji, numbers in mono (tolerance in mm, piece count).

## Functional requirements

- FR-1: A reference file exported from Inkscape **and** one from Illustrator each import
  with correct geometry (paths, béziers, arcs) and correct scale (real units honoured;
  ambiguous units routed through the scale dialog).
- FR-2: On curated messy fixtures (near-miss endpoints, crossing paths, duplicate/
  zero-length segments), healing at a reasonable tolerance produces a network where F-020
  piece detection finds the visually apparent regions.
- FR-3: A completed import is exactly one undo step; undo removes all imported geometry
  and restores the prior document; redo reproduces it identically.
- FR-4: A network exported via F-043 linework SVG, then re-imported at tolerance 0,
  round-trips the network exactly (same nodes, segments, and geometry up to the shared
  `fmt()` precision). Healing is idempotent: re-running it on its own output changes
  nothing.
- FR-5: Unsupported content (text, gradients, clip paths, raster) is dropped and the
  dropped kinds are reported to the user, not silently discarded.

## Technical guidance

- **Parsing lives in a pure module** (candidate: extend `@vitrum/paper`, which already
  owns the F-043 SVG round-trip contract, or a sibling `@vitrum/svg` if paper should stay
  export-only — implementer's call, record it). It must be DOM-free so it is unit-testable
  in `core`/node: parse the SVG string, not a live `SVGElement`. Reuse F-010's arc→cubic
  and bézier primitives; do not hand-roll path maths.
- **Share the F-043 round-trip fixtures.** FR-4 is a shared test suite: export a known
  network to SVG (F-043 `ExportScene`), import it back at tol 0, assert structural +
  geometric equality via the same `fmt()`/id-sort used on the export side.
- **Healing** reuses F-020's pairwise intersection (stable id-ordered direction) and
  position clustering (mirror the 0.01 mm clustering approach); endpoint snapping is a
  clustering at the user tolerance. Emit deterministic ids so redo (FR-3) reproduces the
  import. Keep healing pure and framework-free; the slider's live preview re-runs it.
- **Merge as one command:** build the whole healed network into a single `patchNetwork`
  (self-inverting from pre-state, per F-013) so FR-3 holds and undo is atomic.
- **File reading** goes through an `AppHost` port (mirror the F-022/F-043 port split:
  stubbed in `browserHost`/`fakeHost`, real dialog on desktop, `VITRUM_*_PATH` env
  override for E2E isolation). No Electron imports in `packages/ui`.
- Live preview must debounce heal recomputation on slider drag so large files stay
  responsive; run heal off the main interaction path if it blocks.

## Acceptance criteria

- Vitest unit tests: SVG path parsing (lines/cubic/quadratic/arc), transform composition,
  unit mapping (real units + ambiguous → scale), and the healing operations
  (snap/split/drop) including the idempotence property (FR-4).
- Shared round-trip test with F-043 (FR-4): export → import at tol 0 → assert equality.
- Component test (Testing Library) for the import dialog: options toggle, tolerance slider
  updates the previewed piece count, dropped-content notice appears.
- One Playwright E2E (FR-1 + FR-3): import an Inkscape fixture, confirm pieces are
  detected, then undo restores the empty/prior document in one step.
- Curated messy fixtures committed; FR-2 verified by the implementer (piece count matches
  the visually apparent regions) — note any fixture the reviewer should eyeball.
- All quality gates green: `pnpm lint`, `pnpm format:check`, `pnpm check`, `pnpm test`,
  `pnpm test:e2e`.

## Open questions

_(resolved 2026-07-21 with Mathieu)_

1. Healing tolerance UX — **single tolerance slider with live preview** (piece count +
   healed-change highlight), not a staged wizard. A staged review can follow later if
   fixtures show it is needed.
2. FR-4 round-trip guarantee — **idempotent healing, no-op at tolerance 0** on an
   already-clean network; a single import path, no separate "raw import" mode.
3. Ambiguous units — **scale dialog defaulting to 1 user-unit = 1 mm** with a target-width
   field, not auto-fit or a 96-dpi assumption.
4. Import target — **merge into the active document** as one undo step, not a new document.

## Implementation notes

_Delivered 2026-07-21. All five gates green (lint, format:check, check, test — 856, test:e2e — 23)._

**What shipped**

- **New pure package region `@vitrum/core/svg/`** (not a new package): DOM-free
  `xml`→`parse`→`transform`→`units`→`path`→`heal`→`import` pipeline, re-exported through
  `packages/core/src/index.ts`. Chose `core` over extending `@vitrum/paper` because it reuses
  the F-010 kernel and F-020 `detectPieces` directly and keeps paper export-only; import parses
  an SVG **string** (not a live `SVGElement`), so it unit-tests in Node.
- **Healing** (`heal.ts`): endpoint clustering at the user tolerance, crossing-splits via F-020's
  pairwise intersection, zero-length/duplicate drop, with a per-segment id-stable `HealResult`
  summary. Idempotent and a no-op at tolerance 0 on a clean network (decision #2, FR-4) — proved
  by `heal.property.test.ts`.
- **Import dialog** (`packages/ui/src/import/`): `ImportController` (runes) caches the parsed
  source, holds the single tolerance slider (debounced heal, live read-out), the scale field for
  ambiguous-unit files, and the role; `ImportDialog.svelte` composes `components/core` primitives
  - a new `Slider.svelte`, with a live piece-count preview and dropped-content notice (FR-5).
    Reached from `TopBar`; merges via one `addSegments` command in `AppShell` (decision #4, FR-3).
- **`ImportPort`** on `AppHost` (host.ts) — stubbed in `browserHost`/`fakeHost`, real open dialog
  on desktop, `VITRUM_*_PATH` env override for E2E; no Electron imports leak into `packages/ui`.
- **Shared round-trip contract** lives in `packages/paper/src/svgRoundTrip.test.ts` and drives the
  **real** `@vitrum/core` `parseSvg`, so an export sweep/large-arc bug or an import parse bug fails
  it (FR-4). Committed fixtures: `core/src/svg/fixtures/{inkscape,illustrator}-panel.svg`,
  `messy-network.svg`, and `apps/desktop/e2e/fixtures/inkscape-square.svg`.

**Deviations from the spec**

- FR-4 is verified two ways rather than one: (a) `heal.property.test.ts` asserts idempotence /
  tol-0 no-op, and (b) `svgRoundTrip.test.ts` asserts geometric round-trip by comparing sampled
  points to 1e-6 (stronger than `fmt()`-string equality for curves — arcs reconstruct as kernel
  arcs, not flattened). The spec's literal "compare via `fmt()`/id-sort" wording was not used; the
  sampled-point comparison is a superset. Flagging for sign-off.
- Fixture tests load the committed `.svg` files via Vite `?raw` (ambient decl in
  `core/src/svg/raw.d.ts`) instead of `node:fs`, so pure `core` keeps `lib: ["ES2023"]` with no
  `@types/node` and `pnpm check` passes. _(This was the one gate failing when I resumed the
  branch across a session boundary; the rest of the feature was already implemented and committed.)_

**Verification**

- FR-1 (`fixtures.test.ts`): Inkscape + Illustrator fixtures import at true mm scale, correct
  geometry, expected piece counts. FR-2: `messy-network.svg` finds 0 pieces raw, 2 once healed.
  FR-3 + FR-1: `e2e/svg-import.spec.ts` imports and undoes in one step. FR-5: dialog test asserts
  the dropped-content notice.

**Net-new screen to back-port:** the **Import dialog** (`ImportDialog.svelte`) and the
`Slider.svelte` primitive have no design in the Claude Design project
(`3c259295-607a-4eba-8cad-3890f7e80063`) — built in code to the design system; back-port later.

**Follow-ups (out of scope):** raster autotrace → backlog `F-059`; a staged healing-review wizard
if the single slider proves insufficient on real messy files (decision #1 left the door open).

### Correction (2026-08-07): FR-4 idempotence was not actually holding

The note above claimed FR-4 verified. It was not. `heal.property.test.ts` failed on roughly
**one run in three** — fast-check draws a fresh seed each run, so the original green run was
luck, and the failure went unnoticed until a full-suite run during F-058 caught it.

The bug was in offcut naming, not in the geometry. The first piece of a split keeps its
parent's id, so a segment that already survived one split can be split again on a later pass;
naming its offcut positionally (`${id}~1`) reissued an id an earlier pass had already given to
a different, still-present segment. Two segments then shared an id, and because `changedIds`
compares by id, the mismatched twin was reported as changed on every subsequent pass — so the
network never read as settled even though its geometry had stopped moving. `healOnce` now seeds
a taken-id set from its input and skips anything already used, which stays deterministic in
input order (FR-3 redo still reproduces an import).

Scope of the impact was limited to the "what changed" highlight: `toDrafts` drops ids, so the
document assigns its own on merge and no imported segment was ever lost.

Verification: the shrunk counterexample is now a named regression test in `heal.test.ts`, the
shared `assertIdempotent` helper additionally asserts unique ids and an empty `changedIds`, and
the property test was run 25 times consecutively with no failure (~1-in-3 before the fix).

Standing lesson: a property test with an unpinned seed that runs once per CI run is a
**sampling** check, not a guarantee — treat a first green as weak evidence until it has survived
many runs.
