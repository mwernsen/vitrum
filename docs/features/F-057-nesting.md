# F-057: Sheet nesting & yield optimization

|                |                    |
| -------------- | ------------------ |
| **Phase**      | 5 — Power features |
| **Status**     | done               |
| **Depends on** | F-042              |
| **Complexity** | XL                 |

## Summary

Lay out each glass's cut pieces onto real sheet sizes to minimize waste — the
manufacturing-optimization capstone (only Glass Eye's top Enterprise edition has
this). Replaces F-042's waste-factor heuristic with computed sheet counts and gives
a printable nesting layout per sheet.

## Scope

- Per glass: choose sheet size(s) (from F-022 catalog data or manual), inter-piece
  spacing (cut allowance), grain/streak direction constraint per piece (streaky glass
  is directional — pieces can lock rotation to 0/180°), allowed rotations otherwise.
- Nesting engine: 2D irregular-shape nesting (no-fit-polygon based heuristic — e.g.
  SVGnest-style genetic/greedy approach) running in a worker with progress and
  cancel; good-enough beats optimal (document the approach).
- Result view: sheets rendered with placed, numbered pieces; utilization % per sheet;
  total sheets per glass feeding back into BOM (F-042) and costs (F-056).
- Output: nesting layout as printable PDF (1:1 tiled via F-041 or scaled overview)
  and SVG/DXF per sheet (F-043) for machine cutting.
- Manual adjustment: drag pieces between/within sheets after auto-nest, with overlap
  prevention.

### Non-goals

- Guillotine-cut constraints (glass score-and-break sequencing across a shared sheet
  — real but hard; consider at expansion). Multi-project batch nesting.

## Functional requirements (sketch — refine at expansion)

- FR-1: Nesting respects spacing, rotation and grain constraints (validated
  programmatically on results).
- FR-2: Utilization on the reference panel beats naive bbox packing by a measured
  margin; runs < 30 s.
- FR-3: Nest results are reproducible from a stored seed (nesting is stochastic;
  the seed persists with the result).

## Open questions

1. Should grain direction become a per-assignment property back in F-023's data
   model now (cheap) rather than retrofitting here? Recommendation: add the field
   in F-023, unused until F-057. Confirm.
   → **Resolved (Mathieu, 2026-07-23): keep it out of F-023.** F-023's `assignments`
   were never extended, so grain lives in F-057's own `Project.nesting` intent
   (see Implementation notes) as a per-glass rotation policy — self-contained, no
   retro-touch of a done feature.

## Implementation notes

_Delivered 2026-07-23 on branch `f-057-nesting` (Status: done). Scope agreed with
Mathieu up front (the spec was a draft "expand before implementation"): ship the
nesting engine + on-screen result view; **defer** manual drag-adjustment and all
file outputs (PDF/SVG/DXF per sheet) to follow-ups. Engine algorithm and the grain
data-model home were delegated to the implementer._

**Decisions**

- **Engine — raster/bitmap no-fit nester, not analytic NFP.** The spec's "no-fit-polygon /
  SVGnest" wording is advisory; I built a deterministic bitmap nester in the new pure
  `@vitrum/nest` (`nestSheets`): rasterise each piece (even-odd over outer + holes, so
  holes/concavities fall out for free), dilate by the cut allowance, and place bottom-left-fill
  with word-wise bitmask collision, keeping the best of a few seeded restarts. It interlocks
  concave pieces (the property that beats bbox packing, FR-2), handles holes natively, is far
  simpler to prove correct than orbiting-NFP, and honours "good-enough beats optimal." A genetic
  optimisation loop is a possible fast-follow.
- **Grain / rotation → `Project.nesting` intent** (`NestingSettings`: `spacingMm`, `seed`,
  per-glass `{ sheet?, rotation? }`), schema v14→v15 migration. Only tunable intent is persisted;
  the layout is a **derived output**, recomputed from settings + seed (mirrors `computeBom`), so
  the same document + seed always re-nests identically (FR-3). Grain is a **per-glass** rotation
  policy (`flip`/`fixed`/`quadrant`/`free`), defaulted from the glass texture (streaky ⇒ `flip`,
  0/180° grain-lock) so grain is respected with no per-piece setup (FR-1). Per-piece override is a
  natural extension when the deferred manual-edit layer lands.
- **Shell home — a new `nest` view mode** (not a dock section): the result is a full derived-output
  view like cartoon/render/light. `NestView` renders each sheet as an SVG with placed, numbered
  pieces + per-sheet utilisation; the tunable controls + run/cancel/reshuffle live in a floating
  `NestControls` card, mirroring the F-054 light controls. Auto-nests once on entering the view.
- **Worker** — classic (IIFE) `nest.worker.ts` behind a Sync/Worker runner trio with progress +
  cancel (cancel terminates + respawns the busy worker; a `nestSheets` call is synchronous). Same
  classic-worker reason as F-030: a module worker is blocked under `file://` in the packaged app —
  only the E2E (real `file://` build) exercises it, and it does.

**Verification**

- FR-1: `@vitrum/nest` unit tests assert placed pieces stay in-sheet, never overlap
  (`overlapArea == 0`), keep a real gap ≈ spacing, and only take grain-allowed rotations.
- FR-2: interlocking-triangles reference nests onto 1 sheet where the bbox-shelf baseline
  (`bboxBaseline`) needs 2 (strictly higher utilisation); a 40-piece full-sheet case runs in
  ~250 ms (« 30 s).
- FR-3: identical input + seed ⇒ byte-identical result (`toEqual`); seed rides on the result.
- Model: migration + `updateNestingSettings` undo/redo + serialize round-trip tests.
- UI: `NestController` (sync runner) + `NestView` component tests; Playwright `nesting.spec.ts`
  drives the packaged build — paint a piece, switch to Nest, auto-nest shows a sheet with
  utilisation, reshuffle re-nests.
- Gates green: `pnpm lint`, `format:check`, `check`, `test` (1097), `test:e2e`.

**Deferred follow-ups** (agreed out of scope for v1)

- Manual drag-adjustment of pieces between/within sheets with overlap prevention.
- File outputs: nesting layout as PDF (scaled/1:1 tiled via F-041) and SVG/DXF per sheet (F-043).
- Feed computed sheet counts back into the BOM (F-042) / costs (F-056), replacing the area-based
  `suggestSheet` heuristic (`packages/core/src/bom/bom.ts`) with the nested count.
- Per-piece grain/rotation override (the data model is content-id-ready for it).
- Genetic/annealing optimisation pass over the greedy nester for tighter yields.

**Net-new screens for back-port** (Vitrum Design System / Portal redesign): `nest` view mode +
`NestView` sheet layout + floating `NestControls` card. Built from `components/core` primitives
(Button/Input/Select), tokens only; sheet fills are data-driven (glass colour), exempt like other
rendered document content.

_Cockpit v2 (2026-07-30):_ the floating `NestControls` card moved into the inspector's nest-view context. See the "Cockpit v2 rework" section of
[F-001](F-001-architecture.md) for the full shell IA.
