import type { Vec2 } from '@vitrum/geometry'
import { vec2 } from '@vitrum/geometry'

import type { RectMm } from './page'

/**
 * Pure rectangle clipping (F-041). Tiling draws each page's content translated onto the sheet and
 * relies on clipping so nothing spills into the margins (where the crop marks, page label and
 * calibration ruler live). Clipping is done here in geometry rather than in the PDF backend, which
 * keeps the backend a dumb renderer, keeps output small (no huge off-page geometry), and — the
 * point for F-041 — makes "the overlap band is identical on both adjacent pages" a property we can
 * assert on plain data (FR-2).
 */

/** True if a point is inside (or on) the rectangle. */
function inside(p: Vec2, r: RectMm): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

/**
 * Clip an open polyline to a rectangle (Liang–Barsky per segment), returning the visible pieces.
 * A polyline that crosses the rectangle boundary is split into multiple runs; a fully-outside
 * polyline returns `[]`.
 */
export function clipPolyline(points: readonly Vec2[], r: RectMm): Vec2[][] {
  if (points.length === 0) return []
  if (points.length === 1) return inside(points[0]!, r) ? [[points[0]!]] : []

  const runs: Vec2[][] = []
  let current: Vec2[] = []
  const xMin = r.x
  const xMax = r.x + r.w
  const yMin = r.y
  const yMax = r.y + r.h

  for (let i = 0; i < points.length - 1; i++) {
    const clipped = clipSegment(points[i]!, points[i + 1]!, xMin, xMax, yMin, yMax)
    if (!clipped) {
      if (current.length > 0) {
        runs.push(current)
        current = []
      }
      continue
    }
    const [a, b, aWasClipped] = clipped
    if (current.length === 0) {
      current.push(a, b)
    } else if (aWasClipped) {
      // The visible run was interrupted (a re-entry): start a fresh run at this entry point.
      runs.push(current)
      current = [a, b]
    } else {
      current.push(b)
    }
  }
  if (current.length > 0) runs.push(current)
  return runs
}

/**
 * Liang–Barsky clip of one segment to the rectangle. Returns `[a', b', aWasMoved]` where `aWasMoved`
 * is true when the visible start was pushed inward from the original `a` (i.e. `a` was outside), or
 * `null` when the segment misses the rectangle entirely.
 */
function clipSegment(
  a: Vec2,
  b: Vec2,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): [Vec2, Vec2, boolean] | null {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  const p = [-dx, dx, -dy, dy]
  const q = [a.x - xMin, xMax - a.x, a.y - yMin, yMax - a.y]

  for (let i = 0; i < 4; i++) {
    const pi = p[i]!
    const qi = q[i]!
    if (pi === 0) {
      if (qi < 0) return null // parallel and outside this edge
    } else {
      const t = qi / pi
      if (pi < 0) {
        if (t > t1) return null
        if (t > t0) t0 = t
      } else {
        if (t < t0) return null
        if (t < t1) t1 = t
      }
    }
  }

  const start = vec2(a.x + t0 * dx, a.y + t0 * dy)
  const end = vec2(a.x + t1 * dx, a.y + t1 * dy)
  return [start, end, t0 > 0]
}

/**
 * Clip a polygon ring to a rectangle (Sutherland–Hodgman against the four edges). Returns the
 * clipped ring (empty when fully outside). Convex clip window keeps the result a single ring, which
 * is all F-041's render/cut fills need (each glass piece is a simple face plus holes clipped
 * independently).
 */
export function clipPolygon(ring: readonly Vec2[], r: RectMm): Vec2[] {
  if (ring.length < 3) return []
  const xMin = r.x
  const xMax = r.x + r.w
  const yMin = r.y
  const yMax = r.y + r.h

  let output: Vec2[] = [...ring]
  output = clipEdge(
    output,
    (p) => p.x >= xMin,
    (a, b) => intersectX(a, b, xMin),
  )
  output = clipEdge(
    output,
    (p) => p.x <= xMax,
    (a, b) => intersectX(a, b, xMax),
  )
  output = clipEdge(
    output,
    (p) => p.y >= yMin,
    (a, b) => intersectY(a, b, yMin),
  )
  output = clipEdge(
    output,
    (p) => p.y <= yMax,
    (a, b) => intersectY(a, b, yMax),
  )
  return output.length >= 3 ? output : []
}

function clipEdge(
  input: readonly Vec2[],
  keep: (p: Vec2) => boolean,
  cross: (a: Vec2, b: Vec2) => Vec2,
): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < input.length; i++) {
    const cur = input[i]!
    const prev = input[(i + input.length - 1) % input.length]!
    const curIn = keep(cur)
    const prevIn = keep(prev)
    if (curIn) {
      if (!prevIn) out.push(cross(prev, cur))
      out.push(cur)
    } else if (prevIn) {
      out.push(cross(prev, cur))
    }
  }
  return out
}

function intersectX(a: Vec2, b: Vec2, x: number): Vec2 {
  const t = (x - a.x) / (b.x - a.x)
  return vec2(x, a.y + t * (b.y - a.y))
}

function intersectY(a: Vec2, b: Vec2, y: number): Vec2 {
  const t = (y - a.y) / (b.y - a.y)
  return vec2(a.x + t * (b.x - a.x), y)
}
