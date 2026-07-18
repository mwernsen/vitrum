import { arcToCubics } from './arcmath'
import { bboxOf, bboxOverlap } from './bbox'
import { toBezier, toFlArc, toFlSegment, fromFlPoint } from './convert'
import { cubicPointAt } from './cubicmath'
import { EPS, isZero } from './epsilon'
import { closestPoint, tangentAt } from './measure'
import type { Arc, CubicBezier, Curve, Line, Polyline } from './types'
import { line as mkLine } from './types'
import { add, cross, distance, dot, length as vlength, scale, sub, type Vec2 } from './vec2'

/**
 * One intersection between two curves. Parameters are reported on **both** curves
 * (F-010 FR-2), and endpoint touches and tangencies are classified rather than dropped
 * so downstream planar-graph building (F-020) can decide how to treat them.
 */
export interface Intersection {
  readonly point: Vec2
  /** Parameter on the first curve, in `[0, 1]`. */
  readonly t0: number
  /** Parameter on the second curve, in `[0, 1]`. */
  readonly t1: number
  /** The point coincides with an endpoint of at least one curve. */
  readonly atEndpoint: boolean
  /** The curves are tangent here (parallel tangents) rather than crossing. */
  readonly tangential: boolean
}

/**
 * All intersections between two curves. Uses a bounding-box pre-filter (FR-5) then the
 * best solver for each primitive pair: analytic for segment–segment, `@flatten-js/core`
 * for arc cases, `bezier-js` subdivision for Bézier cases. Polylines are decomposed
 * into their segments. Overlapping/tangential inputs return a documented finite set of
 * points rather than looping.
 */
export function intersect(a: Curve, b: Curve): Intersection[] {
  if (!bboxOverlap(bboxOf(a), bboxOf(b), EPS)) return []
  // Approximate solvers (bezier-js's subdivision, the arc→cubic bridge) return points
  // that can sit up to their tolerance off the true crossing; refine each by alternating
  // projection onto the two curves — a contraction toward the intersection — so the
  // reported point lies on *both* inputs to machine precision (FR-2). Refinement also
  // exposes near-misses (curves that pass within the solver's threshold but never
  // cross): they converge to a mutual closest point with a residual gap, which the
  // acceptance filter then drops.
  const refined = rawPoints(a, b)
    .map((p) => refine(a, b, p))
    .filter((p) => onBoth(a, b, p))
  return dedupe(refined).map((point) => classify(a, b, point))
}

const ACCEPT_TOL = 1e-6

function onBoth(a: Curve, b: Curve, p: Vec2): boolean {
  return closestPoint(a, p).distance <= ACCEPT_TOL && closestPoint(b, p).distance <= ACCEPT_TOL
}

function refine(a: Curve, b: Curve, start: Vec2): Vec2 {
  let cur = start
  for (let i = 0; i < 16; i++) {
    const onA = closestPoint(a, cur).point
    const next = closestPoint(b, onA).point
    if (distance(next, cur) <= 1e-12) return next
    cur = next
  }
  return cur
}

// --- classification --------------------------------------------------------------

function classify(a: Curve, b: Curve, point: Vec2): Intersection {
  const near0 = closestPoint(a, point)
  const near1 = closestPoint(b, point)
  const atEndpoint =
    isEndpoint(a, point) || isEndpoint(b, point) || nearParamEnd(near0.t) || nearParamEnd(near1.t)
  const ta = tangentAt(a, near0.t)
  const tb = tangentAt(b, near1.t)
  const tangential = isZero(cross(ta, tb), 1e-6)
  return { point, t0: near0.t, t1: near1.t, atEndpoint, tangential }
}

function nearParamEnd(t: number): boolean {
  return t <= 1e-9 || t >= 1 - 1e-9
}

function isEndpoint(c: Curve, point: Vec2): boolean {
  return distance(point, curveStart(c)) <= EPS || distance(point, curveEnd(c)) <= EPS
}

function curveStart(c: Curve): Vec2 {
  switch (c.kind) {
    case 'line':
      return c.a
    case 'cubic':
      return c.p0
    case 'polyline':
      return c.points[0]!
    case 'arc':
      return arcToCubics(c)[0]!.p0
  }
}

function curveEnd(c: Curve): Vec2 {
  switch (c.kind) {
    case 'line':
      return c.b
    case 'cubic':
      return c.p3
    case 'polyline':
      return c.points[c.points.length - 1]!
    case 'arc': {
      const cubics = arcToCubics(c)
      return cubics[cubics.length - 1]!.p3
    }
  }
}

// --- raw point solvers -----------------------------------------------------------

function rawPoints(a: Curve, b: Curve): Vec2[] {
  // Decompose polylines into segments and recurse; params are recovered later against
  // the whole curve, so segment-local bookkeeping isn't needed here.
  if (a.kind === 'polyline') return polylineSegments(a).flatMap((s) => rawPoints(s, b))
  if (b.kind === 'polyline') return polylineSegments(b).flatMap((s) => rawPoints(a, s))

  if (a.kind === 'line' && b.kind === 'line') return segmentSegment(a, b)
  if (a.kind === 'cubic' || b.kind === 'cubic') return withBezier(a, b)
  // Remaining pairs involve only lines and arcs → flatten-js handles them robustly.
  return flattenPair(a, b)
}

function polylineSegments(pl: Polyline): Line[] {
  const segs: Line[] = []
  for (let i = 0; i < pl.points.length - 1; i++) segs.push(mkLine(pl.points[i]!, pl.points[i + 1]!))
  return segs
}

/** Analytic segment–segment intersection, including collinear-overlap endpoints. */
function segmentSegment(a: Line, b: Line): Vec2[] {
  const p = a.a
  const r = sub(a.b, a.a)
  const q = b.a
  const s = sub(b.b, b.a)
  const rxs = cross(r, s)
  const qp = sub(q, p)
  const lenR = vlength(r)
  const lenS = vlength(s)

  if (isZero(rxs, 1e-12)) {
    if (!isZero(cross(qp, r), 1e-9 * Math.max(1, lenR))) return [] // parallel, disjoint
    return collinearOverlap(a, b) // collinear — report the shared span's ends
  }

  const t = cross(qp, s) / rxs
  const u = cross(qp, r) / rxs
  const tTol = lenR > 0 ? EPS / lenR : 0
  const uTol = lenS > 0 ? EPS / lenS : 0
  if (t < -tTol || t > 1 + tTol || u < -uTol || u > 1 + uTol) return []
  return [add(p, scale(r, t))]
}

function collinearOverlap(a: Line, b: Line): Vec2[] {
  const r = sub(a.b, a.a)
  const lenSq = dot(r, r)
  if (lenSq === 0) return [] // degenerate segment
  const proj = (pt: Vec2): number => dot(sub(pt, a.a), r) / lenSq
  const b0 = proj(b.a)
  const b1 = proj(b.b)
  const lo = Math.max(0, Math.min(b0, b1))
  const hi = Math.min(1, Math.max(b0, b1))
  if (lo > hi + EPS / Math.sqrt(lenSq)) return [] // no overlap
  const start = add(a.a, scale(r, lo))
  if (Math.abs(hi - lo) <= EPS / Math.sqrt(lenSq)) return [start] // touching at a point
  return [start, add(a.a, scale(r, hi))]
}

/** Any pair drawn from {line, arc} — delegate to flatten-js shapes. */
function flattenPair(a: Line | Arc, b: Line | Arc): Vec2[] {
  const shapeA = a.kind === 'line' ? toFlSegment(a) : toFlArc(a)
  const shapeB = b.kind === 'line' ? toFlSegment(b) : toFlArc(b)
  return shapeA.intersect(shapeB).map(fromFlPoint)
}

/** Any pair where at least one curve is a cubic Bézier. */
function withBezier(a: Curve, b: Curve): Vec2[] {
  if (a.kind === 'cubic' && b.kind === 'cubic') return bezierBezier(a, b)
  if (a.kind === 'cubic' && b.kind === 'line') return bezierLine(a, b)
  if (a.kind === 'line' && b.kind === 'cubic') return bezierLine(b, a)
  if (a.kind === 'cubic' && b.kind === 'arc') return bezierArc(a, b)
  if (a.kind === 'arc' && b.kind === 'cubic') return bezierArc(b, a)
  return [] // unreachable: polylines are decomposed before this point
}

function bezierBezier(a: CubicBezier, b: CubicBezier): Vec2[] {
  const pairs = toBezier(a).intersects(toBezier(b)) as string[]
  return pairs.map((pair) => {
    const t = Number.parseFloat(pair.split('/')[0]!)
    return cubicPointAt(a, t)
  })
}

function bezierLine(c: CubicBezier, l: Line): Vec2[] {
  // bezier-js intersects with the *infinite* line, so keep only hits on the segment.
  const ts = toBezier(c).lineIntersects({ p1: { x: l.a.x, y: l.a.y }, p2: { x: l.b.x, y: l.b.y } })
  const out: Vec2[] = []
  for (const t of ts) {
    const pt = cubicPointAt(c, t)
    const near = closestPoint(l, pt)
    if (near.distance <= EPS) out.push(pt)
  }
  return out
}

function bezierArc(c: CubicBezier, a: Arc): Vec2[] {
  // Approximate the arc as cubics and use Bézier–Bézier subdivision on each piece.
  return arcToCubics(a).flatMap((piece) => bezierBezier(c, piece))
}

// --- dedupe ----------------------------------------------------------------------

function dedupe(points: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of points) {
    if (!out.some((q) => distance(p, q) <= EPS)) out.push(p)
  }
  return out
}
