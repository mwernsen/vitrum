import {
  area as polygonArea,
  bboxOfPoints,
  distance,
  offsetRingVariable,
  polygon,
  type Vec2,
} from '@vitrum/geometry'

import {
  DETECT_DEFAULTS,
  spanPoints,
  type BoundarySpan,
  type Piece,
  type PieceSegment,
} from '../pieces'

import { edgeAllowanceMm } from './allowance'
import type { CutContour, TechniqueSettings } from './types'

/**
 * Cut-contour computation (F-021): inset a detected piece's boundary by the per-edge came/foil
 * allowance to get where the glass is actually cut. Different edges of one piece can inset by
 * different amounts (a heavier perimeter came, a per-segment override), so this is a variable
 * per-edge offset — "offset-each-span + re-intersect adjacent spans" — realized via the kernel's
 * {@link offsetRingVariable}. Straight edges inset exactly (FR-1); curved spans are offset at their
 * flattened facets (each facet carrying its span's allowance), within the flatten tolerance.
 */

/** An allowance resolver per source segment (mm, inward). Injected so this stays technique-agnostic. */
export type AllowanceResolver = (segmentId: string) => number

/**
 * Build a closed ring of flattened boundary points plus the per-edge inward distance array
 * {@link offsetRingVariable} consumes. Each edge carries the allowance of the source span it belongs
 * to; `sign` is `-1` for the outer ring (inset the piece) and `+1` for a hole ring (grow the hole,
 * which shrinks the glass by the same amount).
 */
function ringWithDistances(
  spans: readonly BoundarySpan[],
  segmentsById: ReadonlyMap<string, PieceSegment>,
  allowanceOf: AllowanceResolver,
  sign: number,
  tol: number,
): { ring: Vec2[]; distances: number[] } {
  const verts: { p: Vec2; d: number }[] = []
  let lastD = 0
  for (const span of spans) {
    const seg = segmentsById.get(span.segmentId)
    if (!seg) continue
    // The allowance of every edge arriving at a point walked from this span — including the corner
    // edge from the previous span's end, which geometrically belongs to this span.
    lastD = sign * allowanceOf(span.segmentId)
    for (const p of spanPoints(seg, span, tol)) {
      if (verts.length === 0 || distance(verts[verts.length - 1]!.p, p) > tol) {
        verts.push({ p, d: lastD })
      }
    }
  }
  // Drop the closing vertex if it coincides with the start (rings are stored open), then tag the
  // start vertex with the closing edge's allowance (that edge belongs to the last span walked).
  if (verts.length > 1 && distance(verts[0]!.p, verts[verts.length - 1]!.p) <= tol) verts.pop()
  if (verts.length > 0) verts[0]!.d = lastD

  const n = verts.length
  const ring = verts.map((v) => v.p)
  // distances[i] applies to edge ring[i] → ring[i+1], whose allowance is that of its destination.
  const distances = verts.map((_, i) => verts[(i + 1) % n]!.d)
  return { ring, distances }
}

/**
 * Compute the cut contour for one piece given an allowance resolver. The outer boundary insets
 * inward; any holes grow outward by the same allowance (so the glass shrinks on every edge).
 * Degenerate results (a piece too small to inset) are flagged, never dropped (FR-3).
 */
export function computeCutContour(
  piece: Piece,
  segmentsById: ReadonlyMap<string, PieceSegment>,
  allowanceOf: AllowanceResolver,
  tol = DETECT_DEFAULTS.flattenTolerance,
): CutContour {
  const outer = ringWithDistances(piece.boundary, segmentsById, allowanceOf, -1, tol)
  const outerResult = offsetRingVariable(outer.ring, outer.distances)
  let degenerate = outerResult.selfIntersects

  const holeRings: Vec2[][] = []
  for (const hole of piece.holes) {
    const h = ringWithDistances(hole, segmentsById, allowanceOf, +1, tol)
    const result = offsetRingVariable(h.ring, h.distances)
    if (result.selfIntersects) degenerate = true
    if (result.contour.length >= 3) holeRings.push(result.contour)
  }

  const ring = outerResult.contour
  const poly = polygon(ring, holeRings)
  const allPoints = [...ring, ...holeRings.flat()]
  return {
    pieceId: piece.id,
    ring,
    holeRings,
    area: polygonArea(poly),
    bbox: bboxOfPoints(allPoints.length > 0 ? allPoints : ring),
    degenerate: degenerate || ring.length < 3 || polygonArea(poly) <= 0,
  }
}

/**
 * Compute the cut contour for one piece straight from technique settings — the common call. Uses
 * {@link edgeAllowanceMm} to resolve each edge's came heart / foil-gap allowance.
 */
export function cutContourFor(
  piece: Piece,
  segmentsById: ReadonlyMap<string, PieceSegment>,
  technique: TechniqueSettings,
  tol = DETECT_DEFAULTS.flattenTolerance,
): CutContour {
  return computeCutContour(
    piece,
    segmentsById,
    (segmentId) => edgeAllowanceMm(technique, segmentId),
    tol,
  )
}
