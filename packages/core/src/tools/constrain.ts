import type { Vec2 } from '@vitrum/geometry'
import { add, distance, scale, sub, vec2 } from '@vitrum/geometry'

import type { NumericValue } from './types'

const DEG = Math.PI / 180
/** The angular ladder Shift snaps to: multiples of 45° (0, 45, 90, …). */
const CONSTRAIN_STEP = Math.PI / 4

/**
 * Snap `to` onto the nearest 0/45/90° ray from `from`, preserving its distance (FR-3).
 * Direction is measured with `atan2`, so it works unchanged in the Y-down world. When
 * `to` coincides with `from` the point is returned unchanged (no direction to snap).
 */
export function constrainAngle(from: Vec2, to: Vec2): Vec2 {
  const d = sub(to, from)
  const dist = Math.hypot(d.x, d.y)
  if (dist === 0) return to
  const snapped = Math.round(Math.atan2(d.y, d.x) / CONSTRAIN_STEP) * CONSTRAIN_STEP
  return add(from, vec2(Math.cos(snapped) * dist, Math.sin(snapped) * dist))
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
): Vec2 {
  const length = value.length ?? (hint ? distance(from, hint) : 0)

  let dir: Vec2
  if (value.angle !== undefined) {
    const a = value.angle * DEG
    dir = vec2(Math.cos(a), Math.sin(a))
  } else if (hint) {
    const target = shift ? constrainAngle(from, hint) : hint
    const d = sub(target, from)
    const mag = Math.hypot(d.x, d.y)
    dir = mag === 0 ? vec2(1, 0) : scale(d, 1 / mag)
  } else {
    dir = vec2(1, 0)
  }
  return add(from, scale(dir, length))
}
