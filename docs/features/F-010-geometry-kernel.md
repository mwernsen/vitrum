# F-010: Geometry kernel

|                |              |
| -------------- | ------------ |
| **Phase**      | 1 — Sketcher |
| **Status**     | done         |
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
   **Resolved 2026-07-18 (Mathieu): hybrid wrap.** Wrap `@flatten-js/core` (primitives,
   segment/arc intersections, point-in-polygon, spatial index for FR-5) and `bezier-js`
   (bézier point/tangent/curvature/split, intersection by subdivision) behind our own
   plain-data types and a single epsilon layer; hand-roll the offset operation.
2. Are elliptical arcs needed in v1 (SVG import F-050 will encounter them — they can
   be converted to béziers at import instead)? Recommendation: convert, keep kernel small.
   **Resolved 2026-07-18 (Mathieu): defer.** v1 kernel is circular arcs only; elliptical
   arcs get converted to béziers when F-050 needs them.

## Implementation notes

_Delivered 2026-07-18 as `packages/geometry` (`@vitrum/geometry`)._ Pure data + free
functions, DOM/Svelte/Electron-free and worker-serializable. See the package
[README](../../packages/geometry/README.md) for the API and design rationale.

**Both open questions resolved by Mathieu before coding** (recorded above): hybrid wrap
of `@flatten-js/core` + `bezier-js`, circular arcs only.

**Delivered against the FRs:**

- FR-1 — all listed primitives, queries and operations, typed and documented. Curves are
  a `kind`-tagged discriminated union; generic ops (`intersect`, `curveLength`, `bboxOf`,
  `splitAt`, `flattenCurve`, `transformShape`) dispatch on the tag.
- FR-2 — `intersect` returns parameters on **both** curves plus the point, and flags
  `atEndpoint` / `tangential` rather than dropping those cases. Library references are
  confined to `convert.ts`; every reported point is Newton/projection-refined and then
  verified to lie on both curves within tolerance, so near-misses from the coarse
  subdivision solvers are dropped and true points are exact to machine precision.
- FR-3 — `offsetPolygon` returns a closed contour and sets `selfIntersects` when the outer
  contour folds through itself (self-crossing _or_ orientation reversal for a shape inset
  past its feature size).
- FR-4 — property-based suites (seeded `mulberry32`, reproducible): split-then-measure
  length equals the original ±tol across lines/arcs/cubics; every solver-reported
  intersection lies on both curves and its parameters reproduce the point.
- FR-5 — 10,000 random segment-pair intersections run in **~10 ms** locally (budget
  100 ms), thanks to the bbox pre-filter and an analytic segment–segment path. A permanent
  guard test asserts < 100 ms; a `vitest bench` (`intersect.bench.ts`) is checked in.

**Acceptance criteria:** line coverage **99.66%** (≥95% required), enforced in CI via a new
`Geometry kernel coverage` step (`pnpm test:coverage`; thresholds in the package's
`vitest.config.ts`). Visual debug page at `packages/ui/src/geometry-debug/` — open
`/geometry.html` under `pnpm dev:ui` — renders random intersection and offset cases;
verified rendering live (grown/inset contours offset by the expected distance, intersection
points classified). Benchmark checked in.

**Deviations / decisions worth flagging to Mathieu:**

- **Bézier arc length is a custom adaptive Gauss–Legendre integrator**, not bezier-js's
  fixed-order one, because a fixed-order rule breaks the FR-4 "split preserves length"
  property (the quadrature error shifts after a split). Point/tangent/curvature/split for
  cubics are analytic; bezier-js is used for projection and Bézier–Bézier intersection.
- **Hole handling in `offsetPolygon` is deliberately shallow.** A convex hole inset past
  its half-width cannot be robustly removed by a miter kernel (it produces an antipodal
  mitre artefact of the same winding); truly robust hole collapse/merge needs polygon
  booleans, which F-010 scopes out (a boolean library arrives with F-057). Holes are
  dropped only when their offset degenerates or self-intersects. The came/foil insets that
  motivate offset (F-021) act on simple piece contours, which are unaffected.
- **Arc transforms require an orientation-preserving similarity.** A non-uniform scale
  would make a circular arc elliptical (out of v1 scope) and a reflection flips winding;
  both throw. Convert to cubics first if an arbitrary transform is needed.
- **Repo-infra touch-ups** (needed for green gates, unrelated to a concurrent worktree's
  work): added `@vitest/coverage-v8`; excluded `**/.claude/` from ESLint and Prettier
  (transient agent worktrees are not project source); `@vitrum/geometry` added as a
  browser-safe dependency of `packages/ui` for the debug page.

**Follow-ups discovered, out of scope:** robust polygon offset with hole collapse/merge and
full booleans (revisit with F-057 nesting); elliptical arcs at SVG import (F-050);
`core`'s ad-hoc `Point`/`pieceArea` geometry could migrate onto `@vitrum/geometry` when
F-020 lands so there is one geometry vocabulary.
