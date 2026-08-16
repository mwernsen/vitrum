import { isZero } from './epsilon'
import type { Curve, Polygon, Shape } from './types'
import { arc, cubic, line, polygon, polyline } from './types'
import { vec2, type Vec2 } from './vec2'

/**
 * A 2D affine transform, stored as the six significant entries of the matrix
 *
 * ```
 * | a c e |     x' = a·x + c·y + e
 * | b d f | ,   y' = b·x + d·y + f
 * | 0 0 1 |
 * ```
 *
 * (the same layout as SVG/Canvas `matrix(a,b,c,d,e,f)`), so viewport code can hand its
 * matrices straight in. Plain data, composed with {@link compose}.
 */
export interface Transform2D {
  readonly a: number
  readonly b: number
  readonly c: number
  readonly d: number
  readonly e: number
  readonly f: number
}

export const IDENTITY: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

export function translation(tx: number, ty: number): Transform2D {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty }
}

export function scaling(sx: number, sy = sx): Transform2D {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 }
}

export function rotation(angle: number, center?: Vec2): Transform2D {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const r: Transform2D = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 }
  if (!center) return r
  // Rotate about a point: translate to origin, rotate, translate back.
  return compose(translation(center.x, center.y), r, translation(-center.x, -center.y))
}

/** Compose transforms left-to-right: `compose(A, B)` applies B first, then A. */
export function compose(...transforms: Transform2D[]): Transform2D {
  return transforms.reduce(multiply, IDENTITY)
}

function multiply(m: Transform2D, n: Transform2D): Transform2D {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  }
}

/** Apply the full affine transform to a point. */
export function applyToPoint(t: Transform2D, p: Vec2): Vec2 {
  return vec2(t.a * p.x + t.c * p.y + t.e, t.b * p.x + t.d * p.y + t.f)
}

/** Apply only the linear part (ignore translation) — for directions/tangents. */
export function applyToVector(t: Transform2D, v: Vec2): Vec2 {
  return vec2(t.a * v.x + t.c * v.y, t.b * v.x + t.d * v.y)
}

/** Signed area scale factor of the transform (negative under reflection). */
export function determinant(t: Transform2D): number {
  return t.a * t.d - t.b * t.c
}

/**
 * The inverse transform: `invert(t)` undoes `t`, so `applyToPoint(invert(t), applyToPoint(t, p))`
 * is `p`. Throws when `t` is singular (determinant 0 — a degenerate transform has no inverse).
 * Callers that need to map a point *back* out of a transformed frame — F-052 folds a snapped
 * replica point back to the source sector this way — should use this rather than re-deriving the
 * inverse by hand, which is where sign errors live.
 */
export function invert(t: Transform2D): Transform2D {
  const det = determinant(t)
  if (det === 0) throw new Error('transform is singular and cannot be inverted')
  // Negating a zero entry yields `-0`, which is mathematically identical but formats and compares
  // badly downstream (the same reason exporters fold `-0` to `0`); settle it here.
  const z = (n: number): number => (n === 0 ? 0 : n)
  const a = z(t.d / det)
  const b = z(-t.b / det)
  const c = z(-t.c / det)
  const d = z(t.a / det)
  return { a, b, c, d, e: z(-(a * t.e + c * t.f)), f: z(-(b * t.e + d * t.f)) }
}

/**
 * True when `t`'s linear part is an orientation-preserving similarity — uniform scale +
 * rotation, no reflection or shear. This is exactly the class under which a circular arc
 * stays a circular arc ({@link transformShape} keeps it; otherwise it must be demoted to
 * cubics, F-013). Translation is irrelevant to the test.
 */
export function isSimilarity(t: Transform2D): boolean {
  const col1Sq = t.a * t.a + t.b * t.b
  const col2Sq = t.c * t.c + t.d * t.d
  return isZero(col1Sq - col2Sq, 1e-9) && isZero(t.a * t.c + t.b * t.d, 1e-9) && determinant(t) > 0
}

/**
 * Transform any shape, preserving its kind. Circular arcs are only closed under
 * orientation-preserving **similarities** (uniform scale + rotation + translation); a
 * non-uniform scale would turn an arc elliptical, which v1 does not represent, and a
 * reflection would flip its winding — both throw. Convert such arcs to cubics first
 * (`arcToCubics`) if you need to transform them arbitrarily.
 */
export function transformShape(t: Transform2D, shape: Shape): Shape {
  switch (shape.kind) {
    case 'line':
      return line(applyToPoint(t, shape.a), applyToPoint(t, shape.b))
    case 'cubic':
      return cubic(
        applyToPoint(t, shape.p0),
        applyToPoint(t, shape.p1),
        applyToPoint(t, shape.p2),
        applyToPoint(t, shape.p3),
      )
    case 'polyline':
      return polyline(shape.points.map((p) => applyToPoint(t, p)))
    case 'polygon':
      return transformPolygon(t, shape)
    case 'arc':
      return transformArc(t, shape)
  }
}

/** Convenience wrapper for curves so callers keep a `Curve` type. */
export function transformCurve(t: Transform2D, c: Curve): Curve {
  return transformShape(t, c) as Curve
}

function transformPolygon(t: Transform2D, p: Polygon): Polygon {
  return polygon(
    p.outer.map((v) => applyToPoint(t, v)),
    p.holes.map((h) => h.map((v) => applyToPoint(t, v))),
  )
}

function transformArc(t: Transform2D, a: Shape & { kind: 'arc' }): Shape {
  // Similarity check: columns of the linear part must be equal-length and orthogonal.
  const col1Sq = t.a * t.a + t.b * t.b
  const col2Sq = t.c * t.c + t.d * t.d
  if (!isZero(col1Sq - col2Sq, 1e-9) || !isZero(t.a * t.c + t.b * t.d, 1e-9)) {
    throw new Error('transformShape: non-uniform scale would make a circular arc elliptical')
  }
  if (determinant(t) <= 0) {
    throw new Error('transformShape: reflecting a circular arc is unsupported in v1')
  }
  const scale = Math.sqrt(col1Sq)
  const rot = Math.atan2(t.b, t.a)
  return arc(
    applyToPoint(t, a.center),
    a.radius * scale,
    a.startAngle + rot,
    a.endAngle + rot,
    a.ccw,
  )
}
