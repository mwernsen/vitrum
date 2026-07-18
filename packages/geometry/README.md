# @vitrum/geometry

The pure 2D CAD kernel for Vitrum (feature **F-010**). No DOM, no rendering, no document
model — data types plus free functions, so every export runs unchanged in a Web Worker
(DRC, nesting will call it off the main thread). Everything downstream — piece detection
(F-020), cut contours, DRC, nesting — is only as robust as this package, so it carries
the repo's highest test bar.

## Primitives

`Vec2`, `Line`, `Arc` (circular), `CubicBezier`, `Polyline`, `Polygon` (with holes),
`BBox`, `Transform2D`. Each curve is a discriminated union tagged by `kind`, so generic
operations dispatch on the tag rather than `instanceof`. Constructors: `line`, `arc`,
`cubic`, `polyline`, `polygon`.

## What it does

- **Queries**: `curveLength`, `bboxOf`, `pointAt`, `tangentAt`, `curvatureAt`,
  `closestPoint`, `pointInPolygon`, `area`, `centroid`, `intersect` (all primitive
  pairs, incl. Bézier–Bézier).
- **Operations**: `splitAt`, `offsetLine` / `offsetArc` / `offsetCubic` /
  `offsetPolygon` / `offsetPolyline`, `flattenCurve` (to a polyline within a tolerance),
  `douglasPeucker` / `removeCollinear`, `transformShape`.

## Numerical hygiene

One documented epsilon strategy, in [`src/epsilon.ts`](src/epsilon.ts): tolerances are
**absolute distances in millimetres**, with `EPS = 1e-6` mm. Route every "are these
equal?" decision through the helpers there rather than hand-rolling comparisons at call
sites. `intersect` is robust to tangential/overlapping inputs — it returns a documented
finite set of points rather than crashing or looping.

## Buy vs build (F-010 open question 1, resolved: hybrid wrap)

We wrap two vetted libraries behind our own plain-data types and epsilon layer, keeping
every reference to them inside [`src/convert.ts`](src/convert.ts):

- **`@flatten-js/core`** — segment/arc primitives, their intersections, point-in-polygon,
  and a spatial index (the basis for the FR-5 budget).
- **`bezier-js`** — cubic Bézier evaluation, projection and subdivision intersection.

The **offset** operation is hand-rolled (no library covers closed-contour offset well),
and Bézier arc length is a custom adaptive Gauss–Legendre integrator so that
`length(whole) == length(left) + length(right)` after a split. Approximate intersection
candidates are polished by Newton's method / alternating projection and then verified to
lie on both curves, so reported points are exact to machine precision and near-misses are
dropped.

Elliptical arcs are **not** in v1 (open question 2): SVG import (F-050) converts them to
Béziers, keeping the kernel to circular arcs.

## Commands

```sh
pnpm --filter @vitrum/geometry test            # unit + property-based suites
pnpm --filter @vitrum/geometry exec vitest run --coverage   # ≥95% line coverage gate
pnpm --filter @vitrum/geometry bench           # FR-5 segment-pair benchmark
pnpm dev:ui                                     # then open /geometry.html — visual debug page
```
