import {
  bboxExpand,
  bboxOf,
  bboxOverlap,
  curveLength,
  distance,
  intersect,
  pointAt,
  type BBox,
  type Vec2,
} from '@vitrum/geometry'

import { GridIndex } from '../snap/spatialIndex'
import type { PieceSegment } from './types'

/**
 * The planar graph detection traces faces on. Nodes sit at shared endpoints and at
 * segment–segment crossings; curved segments are split at crossings into edges that keep a
 * reference (`segmentId` + parameter range) back to the true source curve, so the document's
 * segments stay untouched (Scope) while topology is exact.
 */

/** One graph edge: a maximal crossing-free span of a source segment. */
export interface GraphEdge {
  readonly id: number
  readonly segmentId: string
  /** Endpoint vertex ids. */
  readonly from: number
  readonly to: number
  /** Parameter range on the source segment's geometry (`tFrom < tTo`). */
  readonly tFrom: number
  readonly tTo: number
}

export interface PlanarGraph {
  /** Vertex positions, indexed by vertex id. */
  readonly vertices: readonly Vec2[]
  readonly edges: readonly GraphEdge[]
  /** Number of incident edges per vertex (self-loops count twice). */
  readonly degree: readonly number[]
  /** Source segments by id, for property computation and diagnostics. */
  readonly segmentsById: ReadonlyMap<string, PieceSegment>
}

/** A vertex cluster: buckets candidate points so coincident ones collapse to one vertex. */
class VertexClusters {
  readonly #cell: number
  readonly #tol: number
  readonly #buckets = new Map<string, number[]>()
  readonly positions: Vec2[] = []

  constructor(tol: number) {
    this.#tol = tol
    // A cell a touch larger than the tolerance keeps each merge check to the 3×3 neighbourhood.
    this.#cell = Math.max(tol, 1e-9)
  }

  /** Return the id of the vertex at `p`, creating one if none is within tolerance. */
  intern(p: Vec2): number {
    const cx = Math.floor(p.x / this.#cell)
    const cy = Math.floor(p.y / this.#cell)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.#buckets.get(`${cx + dx},${cy + dy}`)
        if (!bucket) continue
        for (const id of bucket) {
          if (distance(this.positions[id]!, p) <= this.#tol) return id
        }
      }
    }
    const id = this.positions.length
    this.positions.push(p)
    const key = `${cx},${cy}`
    const bucket = this.#buckets.get(key)
    if (bucket) bucket.push(id)
    else this.#buckets.set(key, [id])
    return id
  }
}

/** Candidate segment pairs whose bounding boxes overlap — the broad phase for crossings. */
function candidatePairs(boxes: readonly BBox[], tol: number): Array<[number, number]> {
  const index = GridIndex.build(boxes)
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < boxes.length; i++) {
    for (const j of index.query(bboxExpand(boxes[i]!, tol))) {
      if (j > i && bboxOverlap(boxes[i]!, boxes[j]!, tol)) pairs.push([i, j])
    }
  }
  return pairs
}

/**
 * Collect split parameters per segment: 0 and 1 (endpoints) plus every interior crossing
 * with another segment, deduplicated so two crossings closer than `tol` (in real distance
 * along the curve) collapse to one. Endpoints always survive; an interior crossing within
 * `tol` of an endpoint is folded into that endpoint.
 */
function splitParameters(
  segments: readonly PieceSegment[],
  pairs: ReadonlyArray<[number, number]>,
  tol: number,
): number[][] {
  const raw: number[][] = segments.map(() => [0, 1])
  for (const [i, j] of pairs) {
    // Intersect in a stable, id-ordered direction so the reported parameters are identical
    // regardless of input segment order (segment–segment `t` depends on which curve is "a").
    const [lo, hi] = segments[i]!.id <= segments[j]!.id ? [i, j] : [j, i]
    for (const x of intersect(segments[lo]!.geometry, segments[hi]!.geometry)) {
      raw[lo]!.push(x.t0)
      raw[hi]!.push(x.t1)
    }
  }
  return segments.map((seg, i) => {
    const params = dedupeParams(seg, raw[i]!, tol)
    // A single closed-loop segment (a full circle, or a closed bézier) has coincident
    // endpoints, so `[0, 1]` alone would collapse to one vertex and the loop would be dropped
    // as a zero-length edge. Inject quarter-point splits so it forms a proper cycle with
    // distinct vertices — unless crossings already gave it ≥2 interior vertices.
    const closed = distance(pointAt(seg.geometry, 0), pointAt(seg.geometry, 1)) <= tol
    if (closed && params.filter((t) => t > tol && t < 1 - tol).length < 2) {
      return dedupeParams(seg, [...params, 0.25, 0.5, 0.75], tol)
    }
    return params
  })
}

function dedupeParams(seg: PieceSegment, params: number[], tol: number): number[] {
  const sorted = [...params].sort((a, b) => a - b)
  const kept: number[] = []
  for (const t of sorted) {
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t
    const p = pointAt(seg.geometry, clamped)
    if (kept.length === 0 || distance(pointAt(seg.geometry, kept[kept.length - 1]!), p) > tol) {
      kept.push(clamped)
    } else if (clamped === 1) {
      // Ensure the trailing endpoint is represented even when it near-coincides with the
      // previous cut (a very short final span is dropped as an edge below).
      kept[kept.length - 1] = 1
    }
  }
  if (kept.length === 0) return [0, 1]
  if (kept[0] !== 0) kept.unshift(0)
  if (kept[kept.length - 1] !== 1) kept.push(1)
  return kept
}

/**
 * Build the planar graph from output segments (construction guides are excluded — they
 * never become glass, per `@vitrum/model`'s `outputSegments`). Degenerate (near-zero-length)
 * segments are dropped.
 */
export function buildGraph(input: readonly PieceSegment[], tol: number): PlanarGraph {
  const segments = input.filter((s) => s.role !== 'construction' && curveLength(s.geometry) > tol)
  const segmentsById = new Map(segments.map((s) => [s.id, s]))
  const boxes = segments.map((s) => bboxOf(s.geometry))
  const pairs = candidatePairs(boxes, tol)
  const perSegmentParams = splitParameters(segments, pairs, tol)

  const clusters = new VertexClusters(tol)
  const edges: GraphEdge[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const params = perSegmentParams[i]!
    for (let k = 0; k < params.length - 1; k++) {
      const tFrom = params[k]!
      const tTo = params[k + 1]!
      const a = pointAt(seg.geometry, tFrom)
      const b = pointAt(seg.geometry, tTo)
      const from = clusters.intern(a)
      const to = clusters.intern(b)
      // Drop zero-length edges (a crossing coincident with an endpoint, or a sliver span).
      if (from === to || distance(a, b) <= tol) continue
      edges.push({ id: edges.length, segmentId: seg.id, from, to, tFrom, tTo })
    }
  }

  const degree = new Array<number>(clusters.positions.length).fill(0)
  for (const e of edges) {
    degree[e.from]!++
    degree[e.to]!++
  }

  return { vertices: clusters.positions, edges, degree, segmentsById }
}
