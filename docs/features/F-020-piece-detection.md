# F-020: Piece detection (planar graph → faces)

|                |                          |
| -------------- | ------------------------ |
| **Phase**      | 2 — Stained glass domain |
| **Status**     | draft                    |
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

1. Tolerance for near-miss junction detection (proposal: report anything < 0.5 mm;
   auto-weld anything < 0.01 mm silently?) — auto-welding is convenient but mutates
   user data; supervisor call.
