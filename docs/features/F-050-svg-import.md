# F-050: SVG import

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | in-progress        |
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
- **Import target:** the healed network merges into the *active* project as one undo
  step (`patchNetwork` compound command). Import does not create a new document.

### Non-goals

- Raster autotrace (bitmap → vectors). Glass Eye Pro Plus has it; genuinely useful
  with F-051, but a separate hard feature → backlog `F-059 autotrace`.
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

(Filled in by the implementing agent after completion: deviations, follow-ups.)
