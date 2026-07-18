import type { BoundarySpan, Piece, PieceSegment } from '../pieces'

import { edgeAllowanceMm } from './allowance'
import { computeCutContour } from './cutContour'
import type { CutContour, TechniqueSettings } from './types'

/**
 * Cut-contour computation across a whole document, with a cache that recomputes alongside piece
 * detection (F-020): when a piece's boundary or its edges' came/foil allowances are unchanged, its
 * cached contour is reused verbatim; anything else recomputes. A technique switch or a per-segment
 * override changes the affected pieces' allowance signatures and so recomputes exactly those.
 */

function segmentsMap(segments: readonly PieceSegment[]): Map<string, PieceSegment> {
  return new Map(segments.map((s) => [s.id, s]))
}

function geometryHash(seg: PieceSegment | undefined): string {
  if (!seg) return '∅'
  const g = seg.geometry
  const r = (v: number): number => Math.round(v * 1e6)
  switch (g.kind) {
    case 'line':
      return `L,${r(g.a.x)},${r(g.a.y)},${r(g.b.x)},${r(g.b.y)}`
    case 'arc':
      return `A,${r(g.center.x)},${r(g.center.y)},${r(g.radius)},${r(g.startAngle)},${r(g.endAngle)},${g.ccw ? 1 : 0}`
    case 'cubic':
      return `C,${r(g.p0.x)},${r(g.p0.y)},${r(g.p1.x)},${r(g.p1.y)},${r(g.p2.x)},${r(g.p2.y)},${r(g.p3.x)},${r(g.p3.y)}`
  }
}

/**
 * A content signature that changes exactly when a piece's cut contour would: its source segment
 * geometries, the boundary/hole span parameter ranges, and each edge's resolved allowance. Two
 * detections that leave a piece geometrically and materially unchanged produce the same signature.
 */
function contourSignature(
  piece: Piece,
  segmentsById: ReadonlyMap<string, PieceSegment>,
  allowanceOf: (segmentId: string) => number,
): string {
  const spanKey = (s: BoundarySpan): string =>
    `${s.segmentId}@${geometryHash(segmentsById.get(s.segmentId))}:${s.tStart.toFixed(6)}:${s.tEnd.toFixed(6)}:${allowanceOf(s.segmentId).toFixed(6)}`
  const rings = [piece.boundary, ...piece.holes].map((ring) => ring.map(spanKey).join(','))
  return rings.join('|')
}

/** Compute the cut contour for every piece (uncached). */
export function computeCutContours(
  pieces: readonly Piece[],
  segments: readonly PieceSegment[],
  technique: TechniqueSettings,
): CutContour[] {
  const segmentsById = segmentsMap(segments)
  const allowanceOf = (segmentId: string): number => edgeAllowanceMm(technique, segmentId)
  return pieces.map((p) => computeCutContour(p, segmentsById, allowanceOf))
}

/**
 * Incremental cut-contour cache. `update` returns the contour for every current piece, reusing the
 * cached result for any piece whose signature is unchanged and recomputing the rest. Meant to run
 * right after piece detection, sharing its cadence.
 */
export class CutContourCache {
  #cache = new Map<string, { signature: string; contour: CutContour }>()

  update(
    pieces: readonly Piece[],
    segments: readonly PieceSegment[],
    technique: TechniqueSettings,
  ): CutContour[] {
    const segmentsById = segmentsMap(segments)
    const allowanceOf = (segmentId: string): number => edgeAllowanceMm(technique, segmentId)

    const next = new Map<string, { signature: string; contour: CutContour }>()
    const result: CutContour[] = []
    for (const piece of pieces) {
      const signature = contourSignature(piece, segmentsById, allowanceOf)
      const cached = this.#cache.get(piece.id)
      const entry =
        cached && cached.signature === signature
          ? cached
          : { signature, contour: computeCutContour(piece, segmentsById, allowanceOf) }
      next.set(piece.id, entry)
      result.push(entry.contour)
    }
    this.#cache = next
    return result
  }

  /** Discard cached state (e.g. on loading a new document). */
  reset(): void {
    this.#cache = new Map()
  }
}
