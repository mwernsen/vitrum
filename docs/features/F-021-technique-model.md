# F-021: Technique model — lead came & copper foil

|                |                          |
| -------------- | ------------------------ |
| **Phase**      | 2 — Stained glass domain |
| **Status**     | done                     |
| **Depends on** | F-020                    |
| **Complexity** | L                        |

## Summary

The physical construction model: is this panel leaded (came) or copper-foiled
(Tiffany), and what does that imply for how lines render and — critically — where the
glass actually gets cut. Converts the abstract lead-line network + pieces into
technique-aware **cut contours**. This is Vitrum's equivalent of KiCad's design
rules + fabrication parameters layer.

## Domain background (for the implementing agent)

- **Lead came**: H-profile lead strips hold neighboring pieces; the strip has a
  _heart_ (core web, typically ~1.5–2 mm wide) that sits between the pieces. Glass is
  cut smaller than the drawn line: each piece's cut contour is inset by half the heart
  width (plus an optional cutting tolerance). Perimeter uses U- or H-profile came.
  Came widths commonly 4–12 mm (the _flange_ width — visual), hearts ~1.2–2 mm.
- **Copper foil**: each piece is wrapped in adhesive copper foil and soldered to its
  neighbors; pieces nearly touch. Inset is tiny: half the piece gap (~0.4–0.8 mm
  drawn-line allowance) rather than half a heart. Solder bead finish can be silver,
  copper, or black patina (rendering concern). Finer detail and smaller pieces are
  feasible than with lead — DRC thresholds differ per technique (F-031 consumes this).

## Scope

- `TechniqueSettings` on the project: `kind: 'lead' | 'foil'` plus per-kind parameters:
  - lead: default came profile (H/U), flange width, heart width, cutting tolerance;
    per-segment override of came profile/width (heavier perimeter came is standard).
  - foil: foil width, piece gap, solder finish.
- **Cut contour computation**: for each piece, offset its boundary inward by the
  technique-determined allowance (per-edge, since per-segment came overrides mean
  different edges of one piece can inset differently). Uses F-010's offset; results
  cached and recomputed with piece detection.
- Rendering update: lead lines render at true came flange width (zoom-proportional),
  foil designs render with thin solder-colored lines; border came renders distinctly.
- Inspector: technique panel (project level) + per-segment came override UI.
- Switching technique on an existing project recomputes everything and is undoable.

### Non-goals

- DRC rules that _use_ these thresholds (F-031/F-032). Realistic solder/came 3D-ish
  rendering (F-053). Reinforcement bars (F-032 decides if they become entities).

## Functional requirements

- FR-1: For a leaded piece with heart 1.6 mm and tolerance 0.2 mm, every cut-contour
  edge lies exactly 1.0 mm inside the drawn boundary (0.8 + 0.2), verified numerically.
- FR-2: Per-segment came override affects only the cut contours of the two adjacent
  pieces, on the shared edge only.
- FR-3: Cut contours are closed, non-self-intersecting curves; degenerate results
  (piece too small to inset) are flagged as data for DRC, not silently dropped.
- FR-4: Technique switch lead⇄foil preserves all geometry and glass assignments and
  is one undo step.
- FR-5: Sensible defaults shipped: lead H 5 mm flange / 1.5 mm heart; foil 5.6 mm
  (7/32") foil / 0.8 mm gap. Units UI respects mm/inch setting.

## Technical guidance

- Per-edge offsetting of a closed contour with different distances per edge is a
  miter/parallel-edge construction, not a uniform offset — implement in F-010 terms
  as offset-each-span + re-intersect adjacent spans. Sharp concave corners will
  produce the interesting cases; lean on the F-010 visual debug page.
- Keep `TechniqueSettings` serialization stable — F-042/F-043 export it, and the
  file format migration hook (F-002) covers future parameters.

## Acceptance criteria

- Numeric offset tests (FR-1, FR-2) plus closed/simple-contour validation over the
  stress scenes.
- Manual: one panel toggled lead⇄foil shows visibly different line weights and its
  cut contours (dev overlay) shift accordingly; a heavy perimeter came override
  shrinks only border-adjacent pieces.

## Open questions

1. ~~Should came profiles be a small editable library (name, flange, heart — like
   KiCad footprint libs) rather than raw numbers?~~ **Resolved (Mathieu, via
   orchestrator, 2026-07-18): yes — a small editable came profile library
   (KiCad-footprint style). Named profiles carry flange + heart + profile kind
   (H/U), seeded with common Regalead/DHD sizes shipped as data. Segments reference
   a profile with an optional per-segment override. Mirror the two-level pattern
   F-022 will use for glass (global-ish seed + project-local instances), kept
   proportionate to the came library.**
2. ~~Default units for came sizes in inch mode?~~ **Resolved (Mathieu, via
   orchestrator, 2026-07-18): respect the global mm/inch setting via
   `packages/core/src/units.ts` (extend it there, never inline). Came sizes are
   authored/displayed in mm; foil width is shown in fractional inches (as sold,
   e.g. 7/32") with the mm equivalent. No new units mechanism.**

## Implementation notes

Delivered 2026-07-18 on branch `f-021-technique-model` (Status: done, pending the manual
visual/gallery checks listed below). Both open questions were resolved by Mathieu before
coding (recorded above).

**What shipped**

- **Persisted model (`@vitrum/model`)** — new `technique.ts` owns the serialized shape:
  `TechniqueSettings { kind, lead, foil }` with both parameter blocks always present so a
  technique switch preserves the other's params (FR-4). `LeadSettings` carries the editable came
  library (`profiles`, KiCad-footprint style), `defaultProfileId`, `cuttingToleranceMm` and
  per-segment `overrides`; `FoilSettings` carries `foilWidthMm`, `pieceGapMm`, `solderFinish`.
  `SEED_CAME_PROFILES` ships common Regalead/DHD H/U sizes as data; `defaultTechnique()` seeds a
  fresh independent library per project (lead H 5 mm / 1.5 mm heart, foil 5.6 mm ≈ 7/32" / 0.8 mm
  gap — FR-5). New intent-named commands (`setTechniqueKind`, `updateLeadSettings`,
  `updateFoilSettings`, `upsertCameProfile`, `removeCameProfile`, `setCameOverride`) are each a
  single reversible undo entry, expressed over an internal `replaceTechnique` primitive.
- **Serialization migration (F-002 hook)** — schema bumped v2 → v3; `migrateV2ToV3` expands the
  old placeholder `technique: { kind }` into the full lead/foil model, preserving the file's
  chosen kind. F-042/F-043 will export this stable shape.
- **Geometry kernel (`@vitrum/geometry`)** — added `offsetRingVariable(ring, distances)`: a
  per-edge closed-ring offset (positive grows, negative insets, winding-independent) built on the
  existing miter-join/`intersectLines` machinery. Degeneracy is flagged two ways — self-crossing
  and an edge-direction reversal (the tell-tale of an inset past a feature's own half-width, which
  folds into a valid-looking but inside-out contour a crossing/winding test alone misses).
- **Technique geometry (`@vitrum/core/technique`)** — structural mirror of the settings (keeps
  `core` document-independent, the F-020 `Piece`/`PieceSegment` pattern). `edgeAllowanceMm`
  resolves each edge's inward cut-back (lead: heart/2 + tolerance; foil: gap/2). `computeCutContour`
  insets a piece per-edge via `offsetRingVariable` — the "offset-each-span + re-intersect adjacent
  spans" construction, exact for straight edges (FR-1), facet-level within flatten tolerance for
  curves; holes grow so the glass shrinks on every edge; degenerate contours are flagged, never
  dropped (FR-3). `CutContourCache` recomputes alongside piece detection, reusing a piece's contour
  when its geometry + edge allowances are unchanged and recomputing only affected pieces on a
  technique switch or override.
- **UI (`@vitrum/ui`)** — `DocumentController.cutContours(pieces)` owns the cache (reset with the
  detector). Rendering: lead lines draw at true came flange width (zoom-proportional; border came
  distinct), foil designs draw as thin solder-coloured lines (finish-tinted) — all token-sourced.
  New `TechniquePanel` (project-level inspector): technique tabs, default-came select, cutting
  tolerance, an editable came library (per-row flange/heart, add/remove), and foil width (mm +
  fractional-inch hint) / gap / finish. A single selected segment gets a per-segment came override
  select in the inspector. A "Cuts" status-bar toggle draws the cut-contour dev overlay.

**Deviations / decisions**

- **Cut contour realized on flattened facets, not true curve spans.** The guidance's
  "offset-each-span + re-intersect adjacent spans" is honoured via `offsetRingVariable` over the
  piece's boundary facets, each facet carrying its source span's allowance. Straight edges are
  exact (FR-1 verified numerically); curved spans are offset at their flatten-tolerance facets
  (F-020 already represents pieces as flattened rings, and the acceptance is "within tolerance").
  Chosen over curve-level offset+trim for robustness (a single well-tested miter kernel handles
  convex/reflex/curve corners and always yields a closed contour). Curve-exact cut edges are a
  documented follow-up for when F-043 export needs them.
- **Allowance is heart/2 + tolerance for all lead edges (H and U alike).** The H/U `kind` is
  carried for rendering/BOM; a U-specific perimeter inset model is deferred (F-032 territory).
- **Types are mirrored, not shared, between `model` and `core`** (no new `core ← model` edge),
  following the F-020 precedent; the shapes are kept structurally identical.
- **New net-new UI surface** (`TechniquePanel` + per-segment came override + "Cuts" toggle) —
  designed in code from `components/core` primitives and tokens only; flag for back-port to the
  Claude Design project.

**Tests** — geometry `offset.test.ts` (+4, `offsetRingVariable` uniform/variable/degenerate);
core `technique/technique.test.ts` (10: allowance FR-1/FR-5, cut contour FR-1 exact 1.0 mm,
foil, per-segment override FR-2, degenerate FR-3, cache reuse/recompute, plus a property test
that random-grid cut contours are closed and strictly inside their pieces); model
`technique.test.ts` (11: defaults, seeding, all commands with undo/redo FR-4) and `serialize`
v2→v3 migration; UI `TechniquePanel.test.ts` (4) and updated `App.test.ts`; E2E
`technique.spec.ts` (draw panel → switch lead⇄foil, foil params appear, undo restores lead,
toggle cut overlay).

**Verification** — `pnpm lint`, `pnpm format:check`, `pnpm check`, `pnpm test` (442) all green;
`pnpm test:e2e` green (the `app.spec` `afterEach` `app.exit` teardown can hang under heavy
parallel load — a pre-existing, documented flake; app.spec passes cleanly in isolation).

**Handed to Mathieu (pending)** — manual gallery/visual check: draw the F-011 panel, toggle
lead⇄foil and confirm line weights visibly change; turn on "Cuts" and confirm the inset contours
shift with technique and with a heavy perimeter-came override (border-adjacent pieces shrink).

**Follow-ups (out of scope)** — curve-exact cut edges for export (F-043); U-came perimeter inset
model; DRC consuming these thresholds (F-031/F-032); reinforcement bars (F-032); numeric inputs
in `TechniquePanel`/inspector commit per keystroke (extra undo entries) — could debounce/commit
on blur.
