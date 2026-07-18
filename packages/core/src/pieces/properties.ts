import {
  area as polygonArea,
  bboxOfPoints,
  centroid as polygonCentroid,
  distance,
  flattenCurve,
  polygon,
  signedArea,
  splitAt,
  type Curve,
  type Vec2,
} from '@vitrum/geometry'

import type { BoundarySpan, Piece, PieceId, PieceSegment } from './types'

const PARAM_EPS = 1e-9

/**
 * Flatten one boundary span to a polyline in walk order. The span references a sub-range
 * of a source curve; we cut that sub-curve out with the kernel's `splitAt` (exact for
 * lines/arcs/cubics), flatten it, and reverse if the boundary walks the source backwards.
 */
export function spanPoints(seg: PieceSegment, span: BoundarySpan, tol: number): Vec2[] {
  const lo = Math.min(span.tStart, span.tEnd)
  const hi = Math.max(span.tStart, span.tEnd)
  let sub: Curve = seg.geometry
  if (lo > PARAM_EPS) sub = splitAt(sub, lo)[1]
  if (hi < 1 - PARAM_EPS) {
    const remaining = 1 - (lo > PARAM_EPS ? lo : 0)
    const local = remaining <= PARAM_EPS ? 1 : (hi - (lo > PARAM_EPS ? lo : 0)) / remaining
    sub = splitAt(sub, local)[0]
  }
  const pts = flattenCurve(sub, tol)
  return span.tStart > span.tEnd ? [...pts].reverse() : pts
}

/** True length (mm) of a boundary span along its source curve. */
export function spanLength(seg: PieceSegment, span: BoundarySpan, tol: number): number {
  return polylineLength(spanPoints(seg, span, tol))
}

function polylineLength(pts: readonly Vec2[]): number {
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) total += distance(pts[i]!, pts[i + 1]!)
  return total
}

/**
 * Assemble a closed ring (no repeated closing vertex, matching the kernel's `Polygon`
 * convention) from an ordered list of boundary spans, dropping the duplicate join vertices
 * between consecutive spans.
 */
export function ringFromSpans(
  spans: readonly BoundarySpan[],
  segmentsById: ReadonlyMap<string, PieceSegment>,
  tol: number,
): Vec2[] {
  const ring: Vec2[] = []
  for (const span of spans) {
    const seg = segmentsById.get(span.segmentId)
    if (!seg) continue
    for (const p of spanPoints(seg, span, tol)) {
      if (ring.length === 0 || distance(ring[ring.length - 1]!, p) > tol) ring.push(p)
    }
  }
  // Remove the closing vertex if it coincides with the start (rings are stored open).
  if (ring.length > 1 && distance(ring[0]!, ring[ring.length - 1]!) <= tol) ring.pop()
  return ring
}

/** The signed area of a span cycle's flattened ring — used to orient/classify faces. */
export function ringSignedArea(
  spans: readonly BoundarySpan[],
  segmentsById: ReadonlyMap<string, PieceSegment>,
  tol: number,
): number {
  return signedArea(ringFromSpans(spans, segmentsById, tol))
}

/**
 * Build a full {@link Piece} from its outer boundary and any hole boundaries, computing
 * area (holes subtracted), perimeter (every span, outer + holes), centroid and bbox.
 */
export function buildPiece(
  id: PieceId,
  outer: readonly BoundarySpan[],
  holes: readonly (readonly BoundarySpan[])[],
  segmentsById: ReadonlyMap<string, PieceSegment>,
  tol: number,
): Piece {
  const ring = ringFromSpans(outer, segmentsById, tol)
  const holeRings = holes
    .map((h) => ringFromSpans(h, segmentsById, tol))
    .filter((r) => r.length >= 3)
  const poly = polygon(ring, holeRings)

  let perimeter = 0
  for (const span of outer) {
    const seg = segmentsById.get(span.segmentId)
    if (seg) perimeter += spanLength(seg, span, tol)
  }
  for (const hole of holes) {
    for (const span of hole) {
      const seg = segmentsById.get(span.segmentId)
      if (seg) perimeter += spanLength(seg, span, tol)
    }
  }

  const allPoints = [...ring, ...holeRings.flat()]
  return {
    id,
    boundary: outer,
    holes,
    ring,
    holeRings,
    area: polygonArea(poly),
    perimeter,
    centroid: polygonCentroid(poly),
    bbox: bboxOfPoints(allPoints.length > 0 ? allPoints : ring),
  }
}

/**
 * A representative point strictly inside a ring, for containment tests (border filtering,
 * hole nesting). Tries the centroid first (inside for convex-ish glass pieces); if that
 * falls outside a concave ring, steps a hair inward from the shortest edge's midpoint along
 * the inward normal.
 */
export function interiorPoint(ring: readonly Vec2[]): Vec2 {
  const poly = polygon(ring)
  const c = polygonCentroid(poly)
  if (pointStrictlyInside(ring, c)) return c

  const ccw = signedArea(ring) > 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    const ex = b.x - a.x
    const ey = b.y - a.y
    const len = Math.hypot(ex, ey)
    if (len < 1e-9) continue
    // Inward normal: for a CCW ring the interior is to the left of each directed edge.
    const nx = (ccw ? -ey : ey) / len
    const ny = (ccw ? ex : -ex) / len
    const step = Math.min(len, 1) * 0.25
    const p = { x: (a.x + b.x) / 2 + nx * step, y: (a.y + b.y) / 2 + ny * step }
    if (pointStrictlyInside(ring, p)) return p
  }
  return c
}

function pointStrictlyInside(ring: readonly Vec2[], p: Vec2): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    const straddles = a.y > p.y !== b.y > p.y
    if (straddles) {
      const xCross = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)
      if (p.x < xCross) inside = !inside
    }
  }
  return inside
}
