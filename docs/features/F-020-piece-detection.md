# F-020: Piece detection (planar graph → faces)

|                |                          |
| -------------- | ------------------------ |
| **Phase**      | 2 — Stained glass domain |
| **Status**     | done                     |
| **Depends on** | F-010, F-011             |
| **Complexity** | XL                       |

## Summary

The heart of the domain model: derive the glass **pieces** (closed regions) from the
lead-line network automatically and incrementally, the way Diafane detects closed
shapes and the way EDA derives nets from a schematic. Everything downstream — glass
assignment, DRC, numbering, cutting lists — operates on pieces, and pieces are always
recomputed, never hand-maintained.

## User story

As a designer, I draw lead lines; the moment a region closes, Vitrum knows it's a
piece of glass — I never trace or fill shapes manually.

## Scope

- Build a **planar graph** from all `lead` + `border` segments: nodes at shared
  endpoints and at segment–segment crossings (curves split at intersection points for
  graph purposes; the document's segments stay untouched).
- Extract faces via the standard half-edge / angular-sweep face-tracing algorithm;
  discard the outer (unbounded) face; faces outside the border contour are not pieces.
- **Stable piece identity**: pieces get IDs that survive edits that don't change their
  region meaningfully (heuristic: match by area overlap/centroid against the previous
  generation). Glass assignments (F-023) and numbering (F-040) key off these IDs, so
  redrawing one line must not shuffle every piece's glass.
- **Incremental recompute**: on document change, recompute only the affected local
  region (dirty segments' neighborhoods), debounced; full recompute stays available
  and is the correctness reference.
- Diagnostics for imperfect networks (this doubles as the ERC of F-030):
  - dangling ends (segment endpoint with degree 1, not on the border)
  - near-miss junctions (endpoints within tolerance but not welded)
  - overlapping/duplicate segments
- Piece properties computed at detection time: boundary (as ordered curve spans with
  references back to source segments), area, perimeter, centroid, bbox.
- Dev visualization: hover a piece → highlight; overlay coloring of detected pieces;
  list of diagnostics.

### Non-goals

- Cut-contour offsetting (F-021 applies technique parameters to piece boundaries).
- Glass assignment/rendering (F-023). User-facing ERC panel (F-030 — this feature
  exposes diagnostics as data + dev overlay only).

## Functional requirements

- FR-1: For a valid network (all junctions welded, border closed), every bounded
  region inside the border is exactly one piece; total piece area equals border area
  within tolerance (conservation test).
- FR-2: Detection is deterministic: same document → same pieces with same IDs.
- FR-3: Piece IDs are stable under: moving a node slightly, reshaping a curve,
  adding a line that splits an _other_ piece. A split piece yields one heir (larger
  fragment keeps the ID) + one new ID; a merge keeps the larger contributor's ID.
- FR-4: Incremental recompute produces identical output to full recompute
  (property-based test over random edit sequences).
- FR-5: Full recompute of a 500-segment / 200-piece document < 100 ms; incremental
  updates < 16 ms typical (so the colored preview never lags drawing).
- FR-6: Diagnostics correctly identify dangling ends, near-misses (with the distance),
  and duplicates in synthetic broken scenes.

## Technical guidance

- Run detection in a web worker if the main-thread budget is threatened; the geometry
  kernel (F-010) is worker-safe by design.
- Curve faces: trace faces on a _flattened_ (polyline-approximated) graph for
  topology, but keep references to the true curve spans for exact area/rendering.
- Piece-ID stability is the subtle part — implement it as a separate, well-tested
  matching pass (previous generation → new generation) rather than entangling it
  with face tracing.
- Study: KiCad's zone-filling and connectivity code faces the same
  incremental-recompute-with-stable-identity problem; the pattern (dirty region +
  generational matching) is proven.

## Acceptance criteria

- Conservation and determinism property tests green; broken-scene diagnostic tests green.
- Manual: draw the F-011 acceptance panel; pieces light up live while drawing; delete
  and redraw one interior line and verify all other pieces keep their identity
  (visible once F-023 colors them; until then via the dev overlay's stable ID labels).

## Open questions

1. ~~Tolerance for near-miss junction detection (proposal: report anything < 0.5 mm;
   auto-weld anything < 0.01 mm silently?) — auto-welding is convenient but mutates
   user data; supervisor call.~~ **Resolved (Mathieu, 2026-07-18): "report, never
   mutate."** Detect near-misses `< 0.5 mm` as diagnostics carrying their measured
   distance; use the sub-`0.01 mm` epsilon only internally for face-tracing topology
   (never rewrite document endpoints); leave any actual auto-weld to an explicit,
   undoable command as an F-030 concern. No silent mutation of user segments.

## Implementation notes

Delivered 2026-07-18 on branch `f-020-piece-detection` (Status: done, pending the manual
visual/bench checks listed below).

**What shipped**

- New `@vitrum/core/pieces` module (model-independent, mirroring `@vitrum/model`'s
  `Segment` structurally the way the drawing tools mirror `SegmentRole`, so callers pass
  `outputSegments(project)` straight in):
  - `graph.ts` — builds the planar graph: broad-phase crossing detection (reusing the
    F-012 `GridIndex`), curve splitting at crossings (segments split for graph purposes
    only; document geometry untouched), and coincident-vertex clustering at the internal
    `weldTolerance` (0.01 mm).
  - `faces.ts` — half-edge angular-sweep face tracing; per-component cycle tracing kept
    separate from the global assembly (hole nesting + border clipping) so the incremental
    path can cache components. Dangling spurs are pruned before tracing.
  - `properties.ts` — boundary spans (with references back to source segments + parameter
    ranges), flattened rings, area/perimeter/centroid/bbox.
  - `diagnostics.ts` — dangling ends, near-misses (with measured distance), duplicate/
    overlap segments (FR-6), canonically sorted for determinism.
  - `identity.ts` — deterministic cold ids (`contentId`, FNV-1a over the quantized ring)
    plus greedy overlap-area generational matching (`matchIds`): a split keeps the larger
    fragment's id, a merge keeps the larger contributor's (FR-3).
  - `detect.ts` — `detectPieces` (full, authoritative) and `PieceDetector` (incremental).
- `@vitrum/geometry`: added `overlapArea` (polygon intersection area via flatten-js
  `BooleanOperations`, guarded) for the identity matcher.
- Dev visualization (dev-only, gated behind a new "Pieces" status-bar toggle /
  `viewport.piecesVisible`): the real `Canvas` gains an optional piece-fill layer (cycling
  vitrail colours, holes via even-odd, stable-id labels), hover highlight, and diagnostic
  markers; `DocumentController.detect()` runs the incremental detector on demand; the debug
  palette shows live `Pieces:`/`Diagnostics:` counts.

**Deviations / decisions**

- **Placement & worker:** core `pieces/` module, no web worker in v1 (Q2). The kernel is
  worker-safe if FR-5 later demands it.
- **Incremental scope (FR-4/FR-5):** `PieceDetector` caches each connected component's
  traced cycles keyed by the component's segments+geometry and re-runs only the cheap
  global assembly (hole nesting, border clip) and identity match on edit — provably
  identical to a full recompute (property-tested). The crossing **broad-phase is still
  global** each update (`buildGraph` runs fully); true crossing-locality is a documented
  follow-up. This reuses the tracing/property stages, which is where the cost is.
- **Determinism (FR-2):** made input-order-independent by (a) intersecting each pair in a
  stable id-ordered direction (segment–segment `t` depends on which curve is "a"), and (b)
  canonicalizing each face's span rotation and hole order before building pieces, so full
  and incremental paths produce byte-identical pieces and ids.
- **Curved boundaries:** faces are traced on exact endpoint tangents (no separate flattened
  topology graph); area/perimeter are computed from rings flattened at `flattenTolerance`
  (0.05 mm), so they track the true curve within tolerance (≈0.13 % on a r=50 semicircle) —
  consistent with FR-1's "within tolerance".
- **Holes:** disconnected islands inside a face become holes (nested only across different
  connected components, which correctly discards a component's own outer/unbounded cycle);
  conservation still holds (island glass + annulus = container area).

**Tests**

- Core unit (`detect.test.ts`, 16): square/diagonal/grid, curved boundary, border clipping,
  island-as-hole + conservation, determinism, FR-3 identity (move/split/merge/untouched),
  FR-6 diagnostics, incremental-equals-full.
- Core property (`detect.property.test.ts`, 4): FR-1 conservation (200 runs), FR-2
  determinism/order-independence (100 runs), FR-4 incremental==full over random edit
  sequences (150 runs), FR-5 generous-bound perf.
- Geometry `clip.test.ts` (5); UI `controller.test.ts` (+1 integration); E2E
  `pieces.spec.ts` (draw → close → split → dangle, asserting live piece/diagnostic counts).

**Post-review fixes (2026-07-18, after Mathieu's manual check)**

- **Correctness bug — closed single-segment loops.** A full circle (and any closed bézier)
  is emitted by `circleTool` as one segment whose start and end coincide, so `buildGraph`
  was dropping it as a zero-length self-loop — a circle inside a square detected as one
  piece. Fixed in `graph.ts`: a closed-loop segment with fewer than two interior split
  points now gets quarter-point splits injected, so it forms a proper cycle with distinct
  vertices. Added focused regression tests (`detect.test.ts` "disconnected inner loops"):
  circle-in-square → 2 (annulus + disc, areas conserved), circle-in-circle → 2, two disjoint
  circles in a square → 3. Verified live in the browser (colored overlay shows the annulus
  with the circle hole punched via even-odd, plus the disc, each id-labelled).
- **Piece inspector is now live (net-new user-facing surface — back-port to the Claude
  Design project later).** The Inspector's placeholder Panel (Sky/Hill/Sun, a mock Pieces
  count and a Lead total) is replaced: it now shows the real detected piece count and a list
  of pieces (stable id + area + perimeter from `properties.ts`), composed from tokens only,
  sentence case, numbers in mono. Fake glass names/colours and the Lead total are **dropped**
  — named glass is F-023 and lead totals are F-021/F-023 scope, deferred. Detection feeds the
  inspector always (capped at 2000 segments so the debug stress scene stays responsive); the
  coloured canvas overlay stays gated behind the "Pieces" toggle.

**Handed to Mathieu (pending)**

- Manual gallery/visual check: draw the F-011 acceptance panel with the "Pieces" overlay on;
  confirm pieces light up live and that deleting + redrawing one interior line keeps every
  other piece's id (visible via the overlay's id labels).
- FR-5 exact budget (<100 ms full / <16 ms incremental): confirmed only via a loose CI bound
  here; needs a real bench check on target hardware.
- Follow-ups (out of scope): true crossing-locality in the incremental path; optional
  explicit "weld near-miss" command (F-030); moving detection to a worker if needed.

**Additive change for F-023 (2026-07-19).** Added `matchIdsWithLineage` alongside `matchIds`
(unchanged) plus a `lineage` field on `DetectionResult`: a many-to-one map `contentId(current.ring)
→ contentId(ancestor.ring)` giving each piece the previous-generation piece it overlaps most. This
lets glass assignment (F-023) inherit across a split (both fragments point at the parent) and a
merge (the merged piece points at its larger contributor) without a second identity system. Purely
additive — `detectPieces`/`PieceDetector` now populate `lineage`; no existing caller changed.

**Known limitation found from F-052 (2026-08-16) — duplicate edges defeat the face trace.** No code
change here; recorded so the next person does not re-derive it. Two segments tracing the same path
over the same extent, closer together than `weldTolerance`, make `buildGraph` intern their endpoints
to the same vertices (correctly — they _are_ the same points), so a vertex carries two outgoing
half-edges at the same departing angle. `traceCycles`' sweep (`next(he) = the edge clockwise from
twin(he)`) then pairs each copy with the other's twin, and every cycle it traces there closes with
zero signed area, so it falls through both the `> AREA_EPS` and `< -AREA_EPS` arms and is dropped.
The visible effect is severe and silent: a rectangle plus an exact copy of its four sides yields
`pieces = 0` — the whole shape disappears — accompanied only by 4 `duplicate-segment` diagnostics.

- F-052's on-axis symmetry bug was one trigger for this, and was fixed **upstream** in
  `expandReplicas` (a segment fixed by a group element no longer gets a coincident image emitted),
  leaving `pieces/` untouched. See the F-052 "Geometry on an axis is not replicated onto itself"
  note for the measurements.
- The hand-drawn trigger remains: draw the same line twice and detection loses the piece. Worth its
  own ticket. Two candidate fixes: keep only one edge per (vertex pair + path) group in `buildGraph`
  — surgical, but the survivor has to be chosen by segment id, not input order, to preserve FR-2
  determinism; or promote `duplicate-segment` to a blocking DRC error so the user is told to remove
  it. The first is preferable: losing the piece silently is worse than the duplicate itself.
- Partial collinear overlap is a milder relative of the same thing: two rectangles sharing part of a
  bottom edge detect as 2 pieces where 3 regions exist. Untouched by the F-052 fix (a partial overlap
  is genuine second geometry, so suppression correctly leaves it alone).
