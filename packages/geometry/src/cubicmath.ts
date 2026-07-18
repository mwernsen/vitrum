import type { CubicBezier } from './types'
import { cubic } from './types'
import { add, cross, length as vlength, lerp, normalize, scale, sub, type Vec2 } from './vec2'

/**
 * Analytic cubic-Bézier helpers. Point, tangent and curvature are exact and cheap, so
 * we compute them from the control points directly; heavier operations (arc length,
 * closest-point, intersection) route through `bezier-js` via {@link convert}.
 */

/** Position on the curve at `t` (de Casteljau). */
export function cubicPointAt(c: CubicBezier, t: number): Vec2 {
  const ab = lerp(c.p0, c.p1, t)
  const bc = lerp(c.p1, c.p2, t)
  const cd = lerp(c.p2, c.p3, t)
  const abc = lerp(ab, bc, t)
  const bcd = lerp(bc, cd, t)
  return lerp(abc, bcd, t)
}

/** First derivative B'(t) (a velocity vector, not normalized). */
export function cubicVelocity(c: CubicBezier, t: number): Vec2 {
  const u = 1 - t
  // 3(1−t)²(P1−P0) + 6(1−t)t(P2−P1) + 3t²(P3−P2)
  const a = scale(sub(c.p1, c.p0), 3 * u * u)
  const b = scale(sub(c.p2, c.p1), 6 * u * t)
  const d = scale(sub(c.p3, c.p2), 3 * t * t)
  return add(add(a, b), d)
}

/** Second derivative B''(t). */
export function cubicAcceleration(c: CubicBezier, t: number): Vec2 {
  const u = 1 - t
  // 6(1−t)(P2−2P1+P0) + 6t(P3−2P2+P1)
  const a = scale(add(sub(c.p2, scale(c.p1, 2)), c.p0), 6 * u)
  const b = scale(add(sub(c.p3, scale(c.p2, 2)), c.p1), 6 * t)
  return add(a, b)
}

/**
 * Unit tangent at `t`. If the velocity vanishes (coincident control points at an
 * endpoint), fall back to the next derivative so callers still get a direction.
 */
export function cubicTangentAt(c: CubicBezier, t: number): Vec2 {
  const v = cubicVelocity(c, t)
  if (vlength(v) > 1e-12) return normalize(v)
  const a = cubicAcceleration(c, t)
  if (vlength(a) > 1e-12) return normalize(a)
  return normalize(sub(c.p3, c.p0))
}

/** Signed curvature κ(t): positive where the curve turns left (CCW). */
export function cubicCurvatureAt(c: CubicBezier, t: number): number {
  const d1 = cubicVelocity(c, t)
  const d2 = cubicAcceleration(c, t)
  const speed = vlength(d1)
  if (speed < 1e-12) return 0
  return cross(d1, d2) / (speed * speed * speed)
}

// 5-point Gauss–Legendre nodes/weights on [-1, 1], used for arc length.
const GL_X = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664]
const GL_W = [
  0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891,
  0.2369268850561891,
]

/**
 * Arc length of a cubic to high accuracy via adaptive Gauss–Legendre quadrature of the
 * speed |B'(t)|. We roll our own rather than lean on bezier-js's fixed-order
 * quadrature so that `length(whole) == length(left) + length(right)` holds to
 * kernel tolerance after a split (F-010 FR-4), which a fixed-order rule violates.
 */
export function cubicLength(c: CubicBezier, tol = 1e-10): number {
  const speed = (t: number): number => vlength(cubicVelocity(c, t))
  return adaptiveGauss(speed, 0, 1, gauss5(speed, 0, 1), tol, 0)
}

function gauss5(f: (t: number) => number, a: number, b: number): number {
  const half = (b - a) / 2
  const mid = (a + b) / 2
  let sum = 0
  for (let i = 0; i < GL_X.length; i++) sum += GL_W[i]! * f(mid + half * GL_X[i]!)
  return sum * half
}

function adaptiveGauss(
  f: (t: number) => number,
  a: number,
  b: number,
  whole: number,
  tol: number,
  depth: number,
): number {
  const m = (a + b) / 2
  const left = gauss5(f, a, m)
  const right = gauss5(f, m, b)
  if (depth >= 20 || Math.abs(left + right - whole) <= tol) return left + right
  return (
    adaptiveGauss(f, a, m, left, tol / 2, depth + 1) +
    adaptiveGauss(f, m, b, right, tol / 2, depth + 1)
  )
}

/** Split into `[left, right]` at `t` via de Casteljau (both are exact sub-curves). */
export function cubicSplitAt(c: CubicBezier, t: number): [CubicBezier, CubicBezier] {
  const ab = lerp(c.p0, c.p1, t)
  const bc = lerp(c.p1, c.p2, t)
  const cd = lerp(c.p2, c.p3, t)
  const abc = lerp(ab, bc, t)
  const bcd = lerp(bc, cd, t)
  const mid = lerp(abc, bcd, t)
  return [cubic(c.p0, ab, abc, mid), cubic(mid, bcd, cd, c.p3)]
}

/** Flatten to a polyline whose deviation from the true curve is ≤ `tol` (mm). */
export function cubicFlatten(c: CubicBezier, tol: number): Vec2[] {
  const out: Vec2[] = [c.p0]
  flattenInto(c, tol, out, 0)
  return out
}

// Recursive flatness subdivision. A cubic is "flat enough" when both interior control
// points lie within `tol` of the chord; otherwise split at the midpoint and recurse.
function flattenInto(c: CubicBezier, tol: number, out: Vec2[], depth: number): void {
  if (depth >= 24 || isFlat(c, tol)) {
    out.push(c.p3)
    return
  }
  const [l, r] = cubicSplitAt(c, 0.5)
  flattenInto(l, tol, out, depth + 1)
  flattenInto(r, tol, out, depth + 1)
}

function isFlat(c: CubicBezier, tol: number): boolean {
  return distToChord(c.p1, c.p0, c.p3) <= tol && distToChord(c.p2, c.p0, c.p3) <= tol
}

function distToChord(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a)
  const len = vlength(ab)
  if (len < 1e-12) return vlength(sub(p, a))
  return Math.abs(cross(ab, sub(p, a))) / len
}
