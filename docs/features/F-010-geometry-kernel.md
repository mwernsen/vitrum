# F-010: Geometry kernel

|                |              |
| -------------- | ------------ |
| **Phase**      | 1 — Sketcher |
| **Status**     | draft        |
| **Depends on** | F-001        |
| **Complexity** | L            |

## Summary

A pure, exhaustively tested 2D geometry library (`packages/geometry`) — the CAD
kernel of Vitrum. Every downstream feature (piece detection, cut contours, DRC,
nesting) is only as robust as this package, so it gets the highest test bar in the
codebase. No DOM, no rendering, no document model — just math.

## Scope (v1 API surface)

- Primitives: `Vec2`, `Line` (segment), `Arc` (circular), `CubicBezier`, `Polyline`,
  `Polygon` (with holes), `BBox`, `Transform2D`.
- Queries: length, bbox, point-at-t, tangent-at-t, closest-point-on-curve,
  point-in-polygon, curve–curve **intersection** for all primitive pairs (incl.
  bézier–bézier via subdivision), polygon area/centroid, curvature-at-t.
- Operations: split-curve-at-t, **offset** of a curve/closed contour by ±d (needed for
  came heart / foil allowance in F-021 — the hardest op here), flatten-to-polyline
  with tolerance, simplify, boolean point/region tests. Full polygon booleans are NOT
  required in v1 (nesting F-057 may add a library for that).
- Numerical hygiene: a single documented epsilon strategy (absolute tol in mm, e.g.
  1e-6) used consistently; all intersection code robust to tangential/overlapping cases
  at least to the point of _not crashing or looping_ (returning a documented
  approximation is acceptable, silently wrong topology is not).

### Non-goals

- Planar-graph/face extraction (F-020 builds it _on top of_ this package).
- Constraint solving (post-v1, see ROADMAP backlog note in F-013).

## Functional requirements

- FR-1: All listed primitives and queries implemented with typed, documented APIs.
- FR-2: Intersections return parameter values on both curves plus the point; endpoint
  touches and tangencies are classified, not dropped.
- FR-3: Offset of a smooth closed contour returns a closed contour; self-intersecting
  offset results are cleaned or flagged.
- FR-4: Property-based tests: e.g. split-then-measure equals original length ±tol;
  intersections found by the solver actually lie on both curves within tol.
- FR-5: Performance: 10,000 random segment-pair intersection tests < 100 ms
  (piece detection and DRC will call this in hot loops; use bbox pre-filtering).

## Technical guidance

- **Evaluate before building**: `flatten-js` and `bezier-js` cover much of this.
  Wrapping a vetted library behind our own types is preferable to hand-rolling
  bézier–bézier intersection — but the offset operation will likely need custom work
  regardless. Spike both options, present findings before committing (Open question 1).
- Curvature-at-t matters: DRC cuttability (F-031) checks minimum concave radius.
- Keep everything data + free functions (no classes with hidden state); this package
  will run in workers later (DRC, nesting).

## Acceptance criteria

- ≥95% line coverage in `packages/geometry`; property-based suites green in CI.
- A visual debug page (dev-only route in `packages/ui`, viewed via `pnpm dev:ui`)
  that renders random intersection/offset cases — used to eyeball robustness during
  review.
- Benchmark for FR-5 checked into the repo.

## Open questions

1. Buy vs build: wrap `flatten-js`/`bezier-js` or implement from scratch? Agent should
   spike (≤1 day) and report before the supervisor decides.
2. Are elliptical arcs needed in v1 (SVG import F-050 will encounter them — they can
   be converted to béziers at import instead)? Recommendation: convert, keep kernel small.
