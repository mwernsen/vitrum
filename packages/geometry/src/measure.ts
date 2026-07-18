import { arcAngleAt, arcPointAt, arcSweep, arcTangentAt } from './arcmath'
import { toBezier } from './convert'
import {
  cubicAcceleration,
  cubicCurvatureAt,
  cubicFlatten,
  cubicLength,
  cubicPointAt,
  cubicSplitAt,
  cubicTangentAt,
  cubicVelocity,
} from './cubicmath'
import { clamp, clamp01 } from './epsilon'
import type { Arc, CubicBezier, Curve, Line, Polyline } from './types'
import { arc, line, polyline } from './types'
import {
  add,
  distance,
  dot,
  lerp,
  length as vlength,
  normalize,
  scale,
  sub,
  type Vec2,
} from './vec2'

/** A point found on a curve, with the parameter that produced it and its distance. */
export interface ClosestPoint {
  readonly point: Vec2
  readonly t: number
  readonly distance: number
}

/** Arc length of a curve in millimetres. */
export function length(c: Curve): number {
  switch (c.kind) {
    case 'line':
      return distance(c.a, c.b)
    case 'arc':
      return c.radius * arcSweep(c)
    case 'cubic':
      return cubicLength(c)
    case 'polyline':
      return polylineLength(c)
  }
}

/** Position at parameter `t ∈ [0, 1]`. */
export function pointAt(c: Curve, t: number): Vec2 {
  switch (c.kind) {
    case 'line':
      return lerp(c.a, c.b, t)
    case 'arc':
      return arcPointAt(c, t)
    case 'cubic':
      return cubicPointAt(c, t)
    case 'polyline': {
      const { seg, local } = polylineParam(c, t)
      const pts = c.points
      return lerp(pts[seg]!, pts[seg + 1]!, local)
    }
  }
}

/** Unit tangent in the direction of increasing `t`. */
export function tangentAt(c: Curve, t: number): Vec2 {
  switch (c.kind) {
    case 'line':
      return normalize(sub(c.b, c.a))
    case 'arc':
      return arcTangentAt(c, t)
    case 'cubic':
      return cubicTangentAt(c, t)
    case 'polyline': {
      const { seg } = polylineParam(c, t)
      const pts = c.points
      return normalize(sub(pts[seg + 1]!, pts[seg]!))
    }
  }
}

/**
 * Signed curvature κ(t) in 1/mm: positive where the curve turns left. Piecewise-linear
 * curves are flat within a segment, so lines and polylines return 0 (the corners of a
 * polyline are non-differentiable and are reported as 0, not infinity).
 *
 * DRC cuttability (F-031) reads this to enforce a minimum concave radius; the radius of
 * curvature is `1 / |κ|`.
 */
export function curvatureAt(c: Curve, t: number): number {
  switch (c.kind) {
    case 'line':
    case 'polyline':
      return 0
    case 'arc':
      return c.ccw ? 1 / c.radius : -1 / c.radius
    case 'cubic':
      return cubicCurvatureAt(c, t)
  }
}

/** The point on `c` closest to `p`, with its parameter and distance. */
export function closestPoint(c: Curve, p: Vec2): ClosestPoint {
  switch (c.kind) {
    case 'line':
      return closestOnLine(c, p)
    case 'arc':
      return closestOnArc(c, p)
    case 'cubic': {
      // bezier-js gives a good initial guess; Newton-polish it so the result is exact
      // to machine precision (its raw project() is only ~1e-4 accurate, too coarse for
      // the intersection acceptance test in `intersect`).
      const proj = toBezier(c).project({ x: p.x, y: p.y })
      const t = polishCubicClosest(c, p, proj.t ?? 0)
      const point = cubicPointAt(c, t)
      return { point, t, distance: distance(point, p) }
    }
    case 'polyline':
      return closestOnPolyline(c, p)
  }
}

/** Split `c` at parameter `t`, returning the `[before, after]` sub-curves. */
export function splitAt(c: Curve, t: number): [Curve, Curve] {
  const u = clamp01(t)
  switch (c.kind) {
    case 'line': {
      const mid = lerp(c.a, c.b, u)
      return [line(c.a, mid), line(mid, c.b)]
    }
    case 'arc': {
      const midAngle = arcAngleAt(c, u)
      return [
        arc(c.center, c.radius, c.startAngle, midAngle, c.ccw),
        arc(c.center, c.radius, midAngle, c.endAngle, c.ccw),
      ]
    }
    case 'cubic':
      return cubicSplitAt(c, u)
    case 'polyline':
      return splitPolyline(c, u)
  }
}

/**
 * Flatten a curve to a polyline whose maximum deviation from the true curve is ≤ `tol`
 * millimetres. Straight primitives return their defining points; curved ones subdivide
 * until the tolerance is met.
 */
export function flatten(c: Curve, tol: number): Vec2[] {
  if (tol <= 0) throw new Error('flatten: tolerance must be positive')
  switch (c.kind) {
    case 'line':
      return [c.a, c.b]
    case 'polyline':
      return [...c.points]
    case 'arc':
      return flattenArc(c, tol)
    case 'cubic':
      // Analytic flattener (shared with offset/simplify) — no bezier-js round-trip.
      return cubicFlatten(c, tol)
  }
}

// --- internals -------------------------------------------------------------------

function polylineLength(pl: Polyline): number {
  let total = 0
  for (let i = 0; i < pl.points.length - 1; i++) total += distance(pl.points[i]!, pl.points[i + 1]!)
  return total
}

/** Map a global polyline parameter to a segment index and local `[0,1]` parameter. */
function polylineParam(pl: Polyline, t: number): { seg: number; local: number } {
  const n = pl.points.length - 1
  if (n < 1) throw new Error('polyline needs at least 2 points')
  const u = clamp01(t) * n
  let seg = Math.floor(u)
  if (seg >= n) seg = n - 1
  return { seg, local: u - seg }
}

function closestOnLine(l: Line, p: Vec2): ClosestPoint {
  const ab = sub(l.b, l.a)
  const lenSq = dot(ab, ab)
  const t = lenSq === 0 ? 0 : clamp01(dot(sub(p, l.a), ab) / lenSq)
  const point = add(l.a, scale(ab, t))
  return { point, t, distance: distance(point, p) }
}

function closestOnArc(a: Arc, p: Vec2): ClosestPoint {
  const radial = sub(p, a.center)
  // Degenerate: query at the centre — every arc point is equidistant, pick the start.
  if (vlength(radial) < 1e-12) {
    const point = arcPointAt(a, 0)
    return { point, t: 0, distance: distance(point, p) }
  }
  const angle = Math.atan2(radial.y, radial.x)
  const sweep = arcSweep(a)
  let rel = a.ccw ? angle - a.startAngle : a.startAngle - angle
  rel %= Math.PI * 2
  if (rel < 0) rel += Math.PI * 2
  // If the nearest circle point falls outside the sweep, the closest point is whichever
  // endpoint is nearer — measured as the true angular gap (the short way round) to each
  // of the arc's ends at rel = 0 and rel = sweep.
  const TWO_PI = Math.PI * 2
  let t: number
  if (rel <= sweep) {
    t = sweep === 0 ? 0 : rel / sweep
  } else {
    const gapToStart = Math.min(rel, TWO_PI - rel)
    const dEnd = Math.abs(rel - sweep)
    const gapToEnd = Math.min(dEnd, TWO_PI - dEnd)
    t = gapToStart <= gapToEnd ? 0 : 1
  }
  const point = arcPointAt(a, t)
  return { point, t, distance: distance(point, p) }
}

/**
 * Newton's method on g(t) = (B(t) − p)·B′(t) = 0 (stationary distance), seeded from
 * bezier-js's projection. Converges quadratically to the exact nearest parameter,
 * staying clamped to [0, 1].
 */
function polishCubicClosest(c: CubicBezier, p: Vec2, seed: number): number {
  let t = clamp01(seed)
  for (let i = 0; i < 10; i++) {
    const diff = sub(cubicPointAt(c, t), p)
    const d1 = cubicVelocity(c, t)
    const d2 = cubicAcceleration(c, t)
    const g = dot(diff, d1)
    const gp = dot(d1, d1) + dot(diff, d2)
    if (Math.abs(gp) < 1e-12) break
    const next = clamp01(t - g / gp)
    if (Math.abs(next - t) <= 1e-14) return next
    t = next
  }
  return t
}

function closestOnPolyline(pl: Polyline, p: Vec2): ClosestPoint {
  const n = pl.points.length - 1
  let best: ClosestPoint | null = null
  for (let i = 0; i < n; i++) {
    const seg = line(pl.points[i]!, pl.points[i + 1]!)
    const local = closestOnLine(seg, p)
    if (!best || local.distance < best.distance) {
      best = { point: local.point, t: (i + local.t) / n, distance: local.distance }
    }
  }
  if (!best) throw new Error('polyline needs at least 2 points')
  return best
}

function splitPolyline(pl: Polyline, t: number): [Polyline, Polyline] {
  const { seg, local } = polylineParam(pl, t)
  const cut = lerp(pl.points[seg]!, pl.points[seg + 1]!, local)
  const left = [...pl.points.slice(0, seg + 1), cut]
  const right = [cut, ...pl.points.slice(seg + 1)]
  return [polyline(left), polyline(right)]
}

function flattenArc(a: Arc, tol: number): Vec2[] {
  const sweep = arcSweep(a)
  // Sagitta of a sub-arc of angle Δ is r(1 − cos(Δ/2)); bound it by tol.
  const ratio = clamp(1 - tol / a.radius, -1, 1)
  const maxStep = 2 * Math.acos(ratio)
  const segments = Math.max(1, Math.ceil(sweep / maxStep - 1e-9))
  const out: Vec2[] = []
  for (let i = 0; i <= segments; i++) out.push(arcPointAt(a, i / segments))
  return out
}
