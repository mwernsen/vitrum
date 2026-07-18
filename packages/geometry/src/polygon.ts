import type { Polygon } from './types'
import { polygon } from './types'
import type { Vec2 } from './vec2'

/**
 * Signed area of a ring via the shoelace formula. Positive for a counter-clockwise
 * ring, negative for clockwise — the sign is how we detect and normalize orientation.
 */
export function signedArea(ring: readonly Vec2[]): number {
  let sum = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/** Is a ring wound counter-clockwise? */
export function isCCW(ring: readonly Vec2[]): boolean {
  return signedArea(ring) > 0
}

/** Return the ring reversed to the requested winding, or unchanged if already correct. */
export function ensureWinding(ring: readonly Vec2[], ccw: boolean): readonly Vec2[] {
  return isCCW(ring) === ccw ? ring : [...ring].reverse()
}

/**
 * Net area of a polygon in mm²: the outer ring minus its holes. Robust to either
 * winding of the input rings (uses absolute contributions), so callers don't have to
 * pre-normalize.
 */
export function area(p: Polygon): number {
  let a = Math.abs(signedArea(p.outer))
  for (const hole of p.holes) a -= Math.abs(signedArea(hole))
  return a
}

/** Area-weighted centroid of a polygon, holes subtracted. */
export function centroid(p: Polygon): Vec2 {
  let cx = 0
  let cy = 0
  let areaSum = 0
  const accumulate = (ring: readonly Vec2[], sign: number): void => {
    const n = ring.length
    for (let i = 0; i < n; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % n]!
      const cross = a.x * b.y - b.x * a.y
      cx += (a.x + b.x) * cross * sign
      cy += (a.y + b.y) * cross * sign
      areaSum += cross * sign
    }
  }
  // Normalize windings so the outer ring adds and holes subtract regardless of input.
  accumulate(ensureWinding(p.outer, true), 1)
  for (const hole of p.holes) accumulate(ensureWinding(hole, false), 1)
  if (Math.abs(areaSum) < 1e-12) {
    // Degenerate (zero-area) polygon: fall back to the vertex average.
    return vertexAverage(p.outer)
  }
  return { x: cx / (3 * areaSum), y: cy / (3 * areaSum) }
}

function vertexAverage(ring: readonly Vec2[]): Vec2 {
  let x = 0
  let y = 0
  for (const p of ring) {
    x += p.x
    y += p.y
  }
  return { x: x / ring.length, y: y / ring.length }
}

/**
 * Is a point inside a single ring? Uses the crossing-number (ray casting) test; points
 * exactly on an edge are reported as inside (`onBoundary` distinguishes them). Winding
 * does not matter.
 */
export function pointInRing(ring: readonly Vec2[], p: Vec2): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    if (onSegment(a, b, p)) return true
    const straddles = a.y > p.y !== b.y > p.y
    if (straddles) {
      const xCross = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)
      if (p.x < xCross) inside = !inside
    }
  }
  return inside
}

/**
 * Is a point inside the polygon — inside the outer ring and outside every hole? Points
 * on any ring boundary count as inside.
 */
export function pointInPolygon(poly: Polygon, p: Vec2): boolean {
  if (!pointInRing(poly.outer, p)) return false
  for (const hole of poly.holes) {
    // On a hole's boundary still counts as material; strictly inside a hole does not.
    if (pointInRing(hole, p) && !onRing(hole, p)) return false
  }
  return true
}

function onRing(ring: readonly Vec2[], p: Vec2): boolean {
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    if (onSegment(ring[i]!, ring[j]!, p)) return true
  }
  return false
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
  if (Math.abs(cross) > 1e-9) return false
  const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)
  const lenSq = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  return dot >= -1e-9 && dot <= lenSq + 1e-9
}

/** Normalize a polygon to canonical winding: CCW outer ring, CW holes. */
export function normalizePolygon(p: Polygon): Polygon {
  return polygon(
    ensureWinding(p.outer, true),
    p.holes.map((h) => ensureWinding(h, false)),
  )
}
