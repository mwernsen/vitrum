import { Bezier } from 'bezier-js'

import { toBezier } from './convert'
import { EPS } from './epsilon'
import { isCCW, normalizePolygon } from './polygon'
import type { Arc, CubicBezier, Line, Polygon, Polyline } from './types'
import { arc, cubic, line, polygon, polyline } from './types'
import {
  add,
  cross,
  dot,
  leftNormal,
  length as vlength,
  normalize,
  rightNormal,
  scale,
  sub,
  vec2,
  type Vec2,
} from './vec2'

/**
 * The offset (parallel-curve) operation — the hardest primitive in the kernel and the
 * one the spec flags as custom work regardless of the buy-vs-build decision. It is what
 * F-021 will use to derive the lead came heart line and the copper-foil allowance from
 * a piece contour.
 *
 * Sign convention:
 * - Open primitives (`offsetLine`, `offsetArc`, `offsetCubic`) offset by `d` to the
 *   **left of the travel direction** (positive `d`), matching the `leftNormal` helper.
 * - Closed rings (`offsetPolygon`) treat positive `d` as **growing the enclosed region
 *   outward** and negative `d` as insetting it, independent of the ring's stored
 *   winding — the intuitive "outset/inset by d mm" a technique model wants.
 */

/** A closed-contour offset result: the new contour plus whether it self-intersects. */
export interface OffsetResult<T> {
  readonly contour: T
  /**
   * True when the offset folded the contour over itself (typical when insetting by more
   * than the local feature size). The raw contour is still returned so callers can
   * inspect it; FR-3 requires such results be flagged rather than silently wrong.
   */
  readonly selfIntersects: boolean
}

/** Offset a segment to the left of its direction by `d`. */
export function offsetLine(l: Line, d: number): Line {
  const n = scale(normalize(leftNormal(sub(l.b, l.a))), d)
  return line(add(l.a, n), add(l.b, n))
}

/**
 * Offset a circular arc to the left of travel by `d`. For a CCW arc the left side is
 * toward the centre, so the radius shrinks; for a CW arc it grows. Returns `null` if
 * the radius would collapse to ≤ 0 (the offset has passed through the centre).
 */
export function offsetArc(a: Arc, d: number): Arc | null {
  const newRadius = a.ccw ? a.radius - d : a.radius + d
  if (newRadius <= EPS) return null
  return arc(a.center, newRadius, a.startAngle, a.endAngle, a.ccw)
}

/**
 * Offset a cubic Bézier by `d`. A single Bézier generally cannot represent its own
 * parallel curve, so `bezier-js` reduces it to simple sub-curves and offsets each; the
 * result is a chain of cubics. Positive `d` follows the same left-of-travel side as the
 * other primitives.
 */
export function offsetCubic(c: CubicBezier, d: number): CubicBezier[] {
  // bezier-js offsets along its left-hand normal, matching our left-positive convention.
  const pieces = toBezier(c).offset(d) as Bezier[]
  return pieces.map(bezierToCubic)
}

function bezierToCubic(b: Bezier): CubicBezier {
  let cur = b
  while (cur.order < 3) cur = cur.raise()
  const p = cur.points
  return cubic(
    vec2(p[0]!.x, p[0]!.y),
    vec2(p[1]!.x, p[1]!.y),
    vec2(p[2]!.x, p[2]!.y),
    vec2(p[3]!.x, p[3]!.y),
  )
}

/**
 * Offset an open polyline to the left of travel by `d`, mitring the joins (with a
 * bevel fallback at sharp corners past `miterLimit`). End caps are butt (the endpoints
 * simply shift by the end segments' normals).
 */
export function offsetPolyline(pl: Polyline, d: number, miterLimit = 4): OffsetResult<Polyline> {
  const pts = joinOffsetsOpen(pl.points, d, miterLimit)
  return { contour: polyline(pts), selfIntersects: selfIntersects(pts, false) }
}

/**
 * Grow (positive `d`) or inset (negative `d`) the region enclosed by a polygon by `d`
 * millimetres, mitring the corners. The outer ring moves outward and holes shrink
 * accordingly; `selfIntersects` is set when the **outer** contour folds through itself
 * (FR-3 — the primary contract of this function).
 *
 * Scope note: robust removal of holes that collapse past their own half-width, and the
 * merging of contours that overlap after a large offset, need real polygon booleans and
 * are deferred (F-010 non-goal; a boolean library arrives with F-057). Here a hole is
 * dropped only when its offset degenerates (near-zero area) or self-intersects; a convex
 * hole inset past its half-width may survive as a small mitre artefact. Callers needing
 * came/foil insets (F-021) operate on simple piece contours where this is not hit.
 */
export function offsetPolygon(p: Polygon, d: number, miterLimit = 4): OffsetResult<Polygon> {
  const norm = normalizePolygon(p) // CCW outer, CW holes
  const outer = offsetClosedRing(norm.outer, d, miterLimit)
  const holes: Vec2[][] = []
  for (const hole of norm.holes) {
    const grown = offsetClosedRing(hole, -d, miterLimit)
    if (grown.length < 3 || Math.abs(signedAreaOf(grown)) <= EPS) continue
    if (selfIntersects(grown, true)) continue
    holes.push(grown)
  }
  // Invalid if the outer contour crosses itself or, for a shape too thin to inset (e.g.
  // a triangle inset past its inradius), reverses orientation — the normalized outer ring
  // is CCW, so a non-positive area means it folded through itself.
  const invalid = selfIntersects(outer, true) || signedAreaOf(outer) <= EPS
  return { contour: polygon(outer, holes), selfIntersects: invalid }
}

/**
 * Offset a closed ring by a **per-edge** distance — the primitive the technique model (F-021)
 * needs, where different edges of one glass piece inset by different came allowances. `distances`
 * is one value per ring edge (`distances[i]` applies to the edge `ring[i] → ring[i+1]`), with the
 * same sign convention as {@link offsetPolygon}: positive grows the enclosed region outward,
 * negative insets it, independent of the ring's winding.
 *
 * Each edge is offset by its own distance along its outward normal, then adjacent offset edges are
 * re-intersected (miter join, with a bevel fallback past `miterLimit`) — the "offset-each-span +
 * re-intersect adjacent spans" construction. `selfIntersects` is set when the result folds through
 * itself (e.g. a feature inset past its own half-width), which F-021 surfaces as a degenerate,
 * uncuttable piece rather than dropping it (FR-3).
 */
export function offsetRingVariable(
  ring: readonly Vec2[],
  distances: readonly number[],
  miterLimit = 4,
): OffsetResult<Vec2[]> {
  const n = ring.length
  if (n < 3 || distances.length !== n) return { contour: [...ring], selfIntersects: false }

  const ccw = isCCW(ring)
  const dir: Vec2[] = []
  const outwardNormal: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const edge = sub(ring[(i + 1) % n]!, ring[i]!)
    dir.push(normalize(edge))
    outwardNormal.push(normalize(ccw ? rightNormal(edge) : leftNormal(edge)))
  }

  let maxAbs = EPS
  for (const d of distances) maxAbs = Math.max(maxAbs, Math.abs(d))

  // Per-edge offset points at each vertex: `aPoint` on the incoming edge's offset line, `bPoint`
  // on the outgoing edge's. The corner is where those two offset lines meet (a miter).
  const out: Vec2[] = []
  const miter: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n
    const aPoint = add(ring[i]!, scale(outwardNormal[prev]!, distances[prev]!))
    const bPoint = add(ring[i]!, scale(outwardNormal[i]!, distances[i]!))
    const hit = intersectLines(aPoint, dir[prev]!, bPoint, dir[i]!)
    miter.push(hit ?? aPoint)
    if (hit && vlength(sub(hit, ring[i]!)) <= miterLimit * maxAbs + EPS) {
      out.push(hit)
    } else {
      out.push(aPoint)
      if (vlength(sub(aPoint, bPoint)) > EPS) out.push(bPoint)
    }
  }

  // Degeneracy (FR-3). Two independent signals: the contour crosses itself, or an edge *reversed*
  // direction relative to its source — the tell-tale of an inset past a feature's own half-width,
  // which folds into a valid-looking but inside-out contour that neither a crossing nor a winding
  // test alone catches (the fold can stay convex and keep its winding sign).
  let folded = false
  for (let i = 0; i < n && !folded; i++) {
    const edge = sub(miter[(i + 1) % n]!, miter[i]!)
    if (vlength(edge) <= EPS) continue
    if (dot(normalize(edge), dir[i]!) < -EPS) folded = true
  }
  return { contour: out, selfIntersects: selfIntersects(out, true) || folded }
}

// --- ring offset -----------------------------------------------------------------

function offsetClosedRing(ring: readonly Vec2[], d: number, miterLimit: number): Vec2[] {
  // Outward normal points away from the enclosed interior; that depends on winding.
  const ccw = isCCW(ring)
  const outward = (dir: Vec2): Vec2 => normalize(ccw ? rightNormal(dir) : leftNormal(dir))
  return joinOffsetsClosed(ring, d, outward, miterLimit)
}

/** Miter-join the offsets of a closed ring's edges. */
function joinOffsetsClosed(
  ring: readonly Vec2[],
  d: number,
  outward: (dir: Vec2) => Vec2,
  miterLimit: number,
): Vec2[] {
  const n = ring.length
  const dirs: Vec2[] = []
  const normals: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const dir = sub(ring[(i + 1) % n]!, ring[i]!)
    dirs.push(normalize(dir))
    normals.push(outward(dir))
  }
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n
    join(ring[i]!, normals[prev]!, dirs[prev]!, normals[i]!, dirs[i]!, d, miterLimit, out)
  }
  return out
}

/** Miter-join the offsets of an open polyline's edges (butt caps at the ends). */
function joinOffsetsOpen(pts: readonly Vec2[], d: number, miterLimit: number): Vec2[] {
  const n = pts.length
  const dirs: Vec2[] = []
  const normals: Vec2[] = []
  for (let i = 0; i < n - 1; i++) {
    const dir = sub(pts[i + 1]!, pts[i]!)
    dirs.push(normalize(dir))
    normals.push(normalize(leftNormal(dir)))
  }
  const out: Vec2[] = []
  // First point: shifted by the first edge's normal (butt cap).
  out.push(add(pts[0]!, scale(normals[0]!, d)))
  for (let i = 1; i < n - 1; i++) {
    join(pts[i]!, normals[i - 1]!, dirs[i - 1]!, normals[i]!, dirs[i]!, d, miterLimit, out)
  }
  // Last point: shifted by the last edge's normal.
  out.push(add(pts[n - 1]!, scale(normals[n - 2]!, d)))
  return out
}

// Emit the offset vertex (or two, on a bevel) for the corner at `vertex`, joining the
// previous edge (normal `nPrev`, direction `dPrev`) with the current edge.
function join(
  vertex: Vec2,
  nPrev: Vec2,
  dPrev: Vec2,
  nCur: Vec2,
  dCur: Vec2,
  d: number,
  miterLimit: number,
  out: Vec2[],
): void {
  const aPoint = add(vertex, scale(nPrev, d)) // on the previous offset line
  const bPoint = add(vertex, scale(nCur, d)) // on the current offset line
  const hit = intersectLines(aPoint, dPrev, bPoint, dCur)
  if (hit && vlength(sub(hit, vertex)) <= miterLimit * Math.abs(d) + EPS) {
    out.push(hit)
  } else {
    // Parallel edges (straight-through vertex) or an over-long miter: bevel instead.
    out.push(aPoint)
    if (vlength(sub(aPoint, bPoint)) > EPS) out.push(bPoint)
  }
}

/** Infinite-line intersection through `p1` dir `d1` and `p2` dir `d2`; null if parallel. */
function intersectLines(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const denom = cross(d1, d2)
  if (Math.abs(denom) < 1e-12) return null
  const t = cross(sub(p2, p1), d2) / denom
  return add(p1, scale(d1, t))
}

// --- self-intersection flag ------------------------------------------------------

function selfIntersects(pts: readonly Vec2[], closed: boolean): boolean {
  const n = pts.length
  const segCount = closed ? n : n - 1
  for (let i = 0; i < segCount; i++) {
    const a0 = pts[i]!
    const a1 = pts[(i + 1) % n]!
    for (let j = i + 1; j < segCount; j++) {
      // Skip adjacent segments (they legitimately share a vertex).
      if (j === i) continue
      if (closed && (j === (i + 1) % n || (j + 1) % n === i)) continue
      if (!closed && j === i + 1) continue
      const b0 = pts[j]!
      const b1 = pts[(j + 1) % n]!
      if (properIntersect(a0, a1, b0, b1)) return true
    }
  }
  return false
}

function properIntersect(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): boolean {
  const r = sub(a1, a0)
  const s = sub(b1, b0)
  const denom = cross(r, s)
  if (Math.abs(denom) < 1e-12) return false // parallel: ignore (collinear touches aren't folds)
  const t = cross(sub(b0, a0), s) / denom
  const u = cross(sub(b0, a0), r) / denom
  const tol = 1e-9
  return t > tol && t < 1 - tol && u > tol && u < 1 - tol
}

function signedAreaOf(ring: readonly Vec2[]): number {
  let sum = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}
