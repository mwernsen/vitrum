import type { Curve, Vec2 } from '@vitrum/geometry'
import { add, closestPoint, distance, scale, sub, vec2 } from '@vitrum/geometry'

import type { NumericValue } from './types'

const DEG = Math.PI / 180
/** The angular ladder Shift snaps to: multiples of 45° (0, 45, 90, …). */
const CONSTRAIN_STEP = Math.PI / 4
/** The ladder relative to a reference line: parallel and perpendicular, both senses. */
const RELATIVE_STEP = Math.PI / 2

/** Smallest absolute angle between two bearings, in [0, π]. */
function angleBetween(a: number, b: number): number {
  const d = Math.abs(((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return d > Math.PI ? 2 * Math.PI - d : d
}

/**
 * Snap `to` onto the nearest constrained ray from `from`, preserving its distance (FR-3).
 * The ladder is the absolute 0/45/90° one; each direction in `refDirs` adds its own
 * parallel and perpendicular rays, so a span drawn off an existing line can lock to that
 * line's direction as well as to the world axes. Direction is measured with `atan2`, so it
 * works unchanged in the Y-down world. When `to` coincides with `from` the point is
 * returned unchanged (no direction to snap).
 */
export function constrainAngle(from: Vec2, to: Vec2, refDirs: readonly Vec2[] = []): Vec2 {
  const d = sub(to, from)
  const dist = Math.hypot(d.x, d.y)
  if (dist === 0) return to
  const bearing = Math.atan2(d.y, d.x)
  let best = Math.round(bearing / CONSTRAIN_STEP) * CONSTRAIN_STEP
  let bestDelta = angleBetween(bearing, best)
  for (const ref of refDirs) {
    if (ref.x === 0 && ref.y === 0) continue
    const base = Math.atan2(ref.y, ref.x)
    for (let k = 0; k < 4; k++) {
      const candidate = base + k * RELATIVE_STEP
      const delta = angleBetween(bearing, candidate)
      if (delta < bestDelta) {
        bestDelta = delta
        best = candidate
      }
    }
  }
  return add(from, vec2(Math.cos(best) * dist, Math.sin(best) * dist))
}

/**
 * The directions of the straight lines passing through `origin` (within `tolMm`) — the
 * reference directions {@link constrainAngle} adds to the Shift ladder, so a new span can
 * lock parallel or perpendicular to the line it starts from. Curves are skipped: they have
 * no single direction to be parallel to.
 */
export function lineDirectionsAt(
  curves: readonly Curve[],
  origin: Vec2,
  tolMm: number,
): readonly Vec2[] {
  const out: Vec2[] = []
  for (const c of curves) {
    if (c.kind !== 'line') continue
    const d = sub(c.b, c.a)
    if (d.x === 0 && d.y === 0) continue
    if (closestPoint(c, origin).distance > tolMm) continue
    out.push(d)
  }
  return out
}

/**
 * Place a point a numeric length/angle away from `from` (KiCad numeric entry). Priority:
 * an explicit `value.angle` wins; otherwise the direction toward `hint` (the live cursor)
 * is used, optionally Shift-constrained; with neither, +x. `value.length` (world mm)
 * sets the distance — falling back to the current `from→hint` distance if omitted.
 */
export function placeNumeric(
  from: Vec2,
  value: NumericValue,
  hint: Vec2 | null,
  shift = false,
  refDirs: readonly Vec2[] = [],
): Vec2 {
  const length = value.length ?? (hint ? distance(from, hint) : 0)

  let dir: Vec2
  if (value.angle !== undefined) {
    const a = value.angle * DEG
    dir = vec2(Math.cos(a), Math.sin(a))
  } else if (hint) {
    const target = shift ? constrainAngle(from, hint, refDirs) : hint
    const d = sub(target, from)
    const mag = Math.hypot(d.x, d.y)
    dir = mag === 0 ? vec2(1, 0) : scale(d, 1 / mag)
  } else {
    dir = vec2(1, 0)
  }
  return add(from, scale(dir, length))
}
