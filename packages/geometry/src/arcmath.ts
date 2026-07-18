import { EPS } from './epsilon'
import type { Arc, CubicBezier } from './types'
import { cubic } from './types'
import { add, scale, vec2, type Vec2 } from './vec2'

const TWO_PI = Math.PI * 2

/**
 * Signed-to-positive swept angle of an arc, always in `(0, 2π]` for a non-degenerate
 * arc. Sweep direction is folded in via `ccw`, so callers get a magnitude and combine
 * it with direction through {@link arcAngleAt}. A whole number of turns collapses to a
 * single full circle (2π) rather than to 0.
 */
export function arcSweep(a: Arc): number {
  const raw = a.ccw ? a.endAngle - a.startAngle : a.startAngle - a.endAngle
  let d = raw % TWO_PI
  if (d < 0) d += TWO_PI
  if (d <= EPS && Math.abs(raw) > EPS) d = TWO_PI
  return d
}

/** Absolute angle (radians from +x) at parameter `t`. */
export function arcAngleAt(a: Arc, t: number): number {
  const d = arcSweep(a)
  return a.ccw ? a.startAngle + d * t : a.startAngle - d * t
}

export function arcPointAt(a: Arc, t: number): Vec2 {
  const ang = arcAngleAt(a, t)
  return add(a.center, vec2(Math.cos(ang) * a.radius, Math.sin(ang) * a.radius))
}

/** Unit tangent in the direction of increasing `t`. */
export function arcTangentAt(a: Arc, t: number): Vec2 {
  const ang = arcAngleAt(a, t)
  // Radial is (cos, sin); the CCW tangent rotates it +90°, CW rotates it −90°.
  return a.ccw ? vec2(-Math.sin(ang), Math.cos(ang)) : vec2(Math.sin(ang), -Math.cos(ang))
}

export function arcStart(a: Arc): Vec2 {
  return arcPointAt(a, 0)
}

export function arcEnd(a: Arc): Vec2 {
  return arcPointAt(a, 1)
}

/**
 * Approximate an arc as a chain of cubic Béziers, one per ≤90° sub-sweep. This is the
 * bridge used to intersect and offset arcs against Béziers, and to feed SVG-style
 * consumers. The classic control-point magnitude `k = 4/3·tan(Δ/4)` keeps each sub-arc
 * within ~1e-4·r of the true circle — well under kernel tolerance for CAD scales.
 */
export function arcToCubics(a: Arc): CubicBezier[] {
  const total = arcSweep(a)
  const segments = Math.max(1, Math.ceil(total / (Math.PI / 2) - EPS))
  const step = total / segments
  const dir = a.ccw ? 1 : -1
  const k = (4 / 3) * Math.tan(step / 4)
  const out: CubicBezier[] = []
  for (let i = 0; i < segments; i++) {
    const a0 = a.startAngle + dir * step * i
    const a1 = a.startAngle + dir * step * (i + 1)
    const p0 = add(a.center, scale(vec2(Math.cos(a0), Math.sin(a0)), a.radius))
    const p3 = add(a.center, scale(vec2(Math.cos(a1), Math.sin(a1)), a.radius))
    // Tangents at the sub-arc ends, scaled by k·r, give the interior control points.
    const t0 = vec2(-Math.sin(a0), Math.cos(a0))
    const t1 = vec2(-Math.sin(a1), Math.cos(a1))
    const p1 = add(p0, scale(t0, dir * k * a.radius))
    const p2 = add(p3, scale(t1, -dir * k * a.radius))
    out.push(cubic(p0, p1, p2, p3))
  }
  return out
}
