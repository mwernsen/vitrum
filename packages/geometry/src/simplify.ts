import type { Polyline } from './types'
import { polyline } from './types'
import { cross, distance, length as vlength, sub, type Vec2 } from './vec2'

/**
 * Ramer–Douglas–Peucker simplification: drop vertices that lie within `tol`
 * millimetres of the line through the segment they span. Used to thin out
 * over-tessellated imports and flattened curves without moving the shape by more than
 * the tolerance.
 */
export function douglasPeucker(points: readonly Vec2[], tol: number): Vec2[] {
  if (tol < 0) throw new Error('douglasPeucker: tolerance must be ≥ 0')
  if (points.length <= 2) return [...points]
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  simplifySection(points, 0, points.length - 1, tol, keep)
  return points.filter((_, i) => keep[i])
}

function simplifySection(
  points: readonly Vec2[],
  first: number,
  last: number,
  tol: number,
  keep: boolean[],
): void {
  if (last <= first + 1) return
  let maxDist = -1
  let index = first
  const a = points[first]!
  const b = points[last]!
  for (let i = first + 1; i < last; i++) {
    const dist = perpendicularDistance(points[i]!, a, b)
    if (dist > maxDist) {
      maxDist = dist
      index = i
    }
  }
  if (maxDist > tol) {
    keep[index] = true
    simplifySection(points, first, index, tol, keep)
    simplifySection(points, index, last, tol, keep)
  }
}

function perpendicularDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a)
  const len = vlength(ab)
  if (len < 1e-12) return distance(p, a)
  return Math.abs(cross(ab, sub(p, a))) / len
}

/** Simplify a polyline in place of its points, preserving its endpoints. */
export function simplifyPolyline(pl: Polyline, tol: number): Polyline {
  return polyline(douglasPeucker(pl.points, tol))
}

/**
 * Remove interior vertices that are collinear with their neighbours (within `tol`),
 * plus exact duplicates. Unlike Douglas–Peucker this only deletes redundant points, so
 * it never changes the shape — handy for cleaning offset/boolean output.
 */
export function removeCollinear(points: readonly Vec2[], tol = 1e-6, closed = false): Vec2[] {
  const src = dedupeConsecutive(points, closed)
  const n = src.length
  if (n <= 2) return src
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(src[i]!)
      continue
    }
    const prev = src[(i - 1 + n) % n]!
    const next = src[(i + 1) % n]!
    if (perpendicularDistance(src[i]!, prev, next) > tol) out.push(src[i]!)
  }
  return out
}

function dedupeConsecutive(points: readonly Vec2[], closed: boolean): Vec2[] {
  const out: Vec2[] = []
  for (const p of points) {
    if (out.length === 0 || distance(out[out.length - 1]!, p) > 1e-9) out.push(p)
  }
  if (closed && out.length > 1 && distance(out[0]!, out[out.length - 1]!) <= 1e-9) out.pop()
  return out
}
