import type { BoundarySpan, Piece, PieceSegment } from '@vitrum/core'
import {
  cross,
  curvatureAt,
  dot,
  negate,
  pointAt,
  signedArea,
  tangentAt,
  type Vec2,
} from '@vitrum/geometry'

/**
 * Boundary geometry the cuttability pack (F-031) evaluates on a piece's **true curves**, not on the
 * flattened cut-contour polygon (FR-3): corner angles at the vertices where boundary spans meet, and
 * the tightest concave radius along each curved span. Reading `F-010`'s `curvatureAt`/`tangentAt`
 * directly keeps arcs and béziers exact — a gently curved edge never masquerades as a chain of sharp
 * polyline kinks, and a tight inside curve is measured at its real radius.
 *
 * A piece's outer boundary is walked in ring order; its winding (`signedArea` sign) tells convex
 * from concave. Holes are out of scope here (an enclosed internal cut is a rare, separate problem —
 * see the F-031 notes); size rules still account for holes via the inscribed-width proxy.
 */

/** A corner where two boundary spans meet, with its interior angle and convex/concave class. */
export interface Corner {
  readonly at: Vec2
  /** Interior angle in radians, in (0, 2π). Below π is convex; above π is a reflex (inside) corner. */
  readonly interiorAngle: number
  readonly convex: boolean
  readonly segmentIds: readonly string[]
}

/** The tightest concave point found on one curved boundary span. */
export interface CurvatureHit {
  readonly at: Vec2
  /** Radius of curvature in mm at the tightest concave sample (1 / |κ|). */
  readonly radiusMm: number
  readonly segmentId: string
}

/** Below this turn (radians) a span-to-span join is smooth, not a corner. ~0.06° — numeric only. */
const SMOOTH_EPS = 1e-3

/** Unit tangent along the boundary walk at a span's start vertex. */
function walkTangentStart(seg: PieceSegment, span: BoundarySpan): Vec2 {
  const tan = tangentAt(seg.geometry, span.tStart)
  return span.tStart > span.tEnd ? negate(tan) : tan
}

/** Unit tangent along the boundary walk at a span's end vertex. */
function walkTangentEnd(seg: PieceSegment, span: BoundarySpan): Vec2 {
  const tan = tangentAt(seg.geometry, span.tEnd)
  return span.tStart > span.tEnd ? negate(tan) : tan
}

/**
 * The corners of a piece's outer boundary. At each vertex the interior angle is derived from the
 * incoming and outgoing walk tangents and the ring's winding, so it is correct whichever way the
 * detector wound the ring. Smooth span joins (tangent-continuous curves, or a segment split into
 * several spans) contribute no corner.
 */
export function cornersOf(piece: Piece, segmentsById: ReadonlyMap<string, PieceSegment>): Corner[] {
  const spans = piece.boundary
  const n = spans.length
  if (n < 2) return []
  const orient = Math.sign(signedArea(piece.ring)) || 1
  const out: Corner[] = []
  for (let i = 0; i < n; i++) {
    const cur = spans[i]!
    const nxt = spans[(i + 1) % n]!
    const segCur = segmentsById.get(cur.segmentId)
    const segNxt = segmentsById.get(nxt.segmentId)
    if (!segCur || !segNxt) continue
    const dIn = walkTangentEnd(segCur, cur)
    const dOut = walkTangentStart(segNxt, nxt)
    const turn = Math.atan2(cross(dIn, dOut), dot(dIn, dOut)) // signed, (−π, π]
    if (Math.abs(turn) < SMOOTH_EPS) continue
    const interiorAngle = Math.PI - orient * turn // (0, 2π)
    out.push({
      at: pointAt(segCur.geometry, cur.tEnd),
      interiorAngle,
      convex: interiorAngle < Math.PI,
      segmentIds:
        cur.segmentId === nxt.segmentId ? [cur.segmentId] : [cur.segmentId, nxt.segmentId],
    })
  }
  return out
}

/**
 * The tightest concave point on each curved boundary span (one hit per span that bends into the
 * glass anywhere). Concavity is `orient · κ < 0`: the curve turns opposite to the overall winding,
 * i.e. the glass wraps around empty space — an inside curve. Straight spans and convex bulges are
 * skipped. `samples` fixes the sampling density along each span (arcs are constant-curvature, so one
 * sample suffices; béziers vary, so we scan).
 */
export function concaveCurvatureHits(
  piece: Piece,
  segmentsById: ReadonlyMap<string, PieceSegment>,
  samples = 16,
): CurvatureHit[] {
  const orient = Math.sign(signedArea(piece.ring)) || 1
  const out: CurvatureHit[] = []
  for (const span of piece.boundary) {
    const seg = segmentsById.get(span.segmentId)
    if (!seg || seg.geometry.kind === 'line') continue
    const g = seg.geometry
    const reversed = span.tStart > span.tEnd
    const lo = Math.min(span.tStart, span.tEnd)
    const hi = Math.max(span.tStart, span.tEnd)
    let tight: CurvatureHit | null = null
    for (let s = 0; s <= samples; s++) {
      const t = lo + ((hi - lo) * s) / samples
      const kappa = (reversed ? -1 : 1) * curvatureAt(g, t)
      if (orient * kappa >= 0 || kappa === 0) continue // convex or flat here
      const radiusMm = 1 / Math.abs(kappa)
      if (!tight || radiusMm < tight.radiusMm) {
        tight = { at: pointAt(g, t), radiusMm, segmentId: span.segmentId }
      }
    }
    if (tight) out.push(tight)
  }
  return out
}
