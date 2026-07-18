import { negate, pointInRing, tangentAt, type Vec2 } from '@vitrum/geometry'

import type { GraphEdge, PlanarGraph } from './graph'
import { interiorPoint, ringFromSpans, ringSignedArea } from './properties'
import type { BoundarySpan, PieceSegment } from './types'

const AREA_EPS = 1e-6

/** A traced region: an outer ring as ordered curve spans plus any nested hole rings. */
export interface FaceGeom {
  readonly outer: readonly BoundarySpan[]
  readonly holes: readonly (readonly BoundarySpan[])[]
}

/**
 * The raw output of tracing one subgraph, before global assembly. `ccw` holds
 * counter-clockwise cycles (candidate bounded faces); `cw` holds clockwise cycles (the
 * unbounded face and any island silhouettes, which become holes). Kept separate so the
 * incremental detector can cache a connected component's cycles and re-run only the cheap
 * global nesting/border pass (FR-4/FR-5).
 */
export interface RawCycles {
  readonly ccw: readonly (readonly BoundarySpan[])[]
  readonly cw: ReadonlyArray<{
    readonly spans: readonly BoundarySpan[]
    readonly ring: readonly Vec2[]
  }>
}

interface HalfEdge {
  readonly id: number
  readonly origin: number
  readonly dest: number
  readonly span: BoundarySpan
  readonly angle: number
  twin: number
  order: number
}

function departingAngle(seg: PieceSegment, t: number, forward: boolean): number {
  const tan = tangentAt(seg.geometry, t)
  const dir = forward ? tan : negate(tan)
  return Math.atan2(dir.y, dir.x)
}

/**
 * Trace the cycles of a planar subgraph via the standard half-edge angular sweep: sort each
 * vertex's outgoing half-edges by departing angle, and walk `next(he) = the edge clockwise
 * from twin(he)`. Every face is traced with its interior on the left, so bounded faces come
 * out counter-clockwise (positive signed area) and the unbounded face and island silhouettes
 * come out clockwise.
 */
export function traceCycles(
  vertexCount: number,
  edges: readonly GraphEdge[],
  segmentsById: ReadonlyMap<string, PieceSegment>,
  tol: number,
): RawCycles {
  const halfEdges: HalfEdge[] = []
  const outgoing: number[][] = Array.from({ length: vertexCount }, () => [])

  for (const e of edges) {
    const seg = segmentsById.get(e.segmentId)
    if (!seg) continue
    const fwdId = halfEdges.length
    const revId = fwdId + 1
    halfEdges.push({
      id: fwdId,
      origin: e.from,
      dest: e.to,
      span: { segmentId: e.segmentId, tStart: e.tFrom, tEnd: e.tTo },
      angle: departingAngle(seg, e.tFrom, true),
      twin: revId,
      order: 0,
    })
    halfEdges.push({
      id: revId,
      origin: e.to,
      dest: e.from,
      span: { segmentId: e.segmentId, tStart: e.tTo, tEnd: e.tFrom },
      angle: departingAngle(seg, e.tTo, false),
      twin: fwdId,
      order: 0,
    })
    outgoing[e.from]!.push(fwdId)
    outgoing[e.to]!.push(revId)
  }

  for (const list of outgoing) {
    list.sort((a, b) => halfEdges[a]!.angle - halfEdges[b]!.angle || a - b)
    list.forEach((id, i) => (halfEdges[id]!.order = i))
  }

  const next = (he: HalfEdge): HalfEdge => {
    const twin = halfEdges[he.twin]!
    const ring = outgoing[twin.origin]!
    // The next edge around the face is the one immediately clockwise from the twin, which
    // traces each bounded face with its interior on the left (counter-clockwise).
    return halfEdges[ring[(twin.order - 1 + ring.length) % ring.length]!]!
  }

  const visited = new Array<boolean>(halfEdges.length).fill(false)
  const ccw: BoundarySpan[][] = []
  const cw: Array<{ spans: BoundarySpan[]; ring: readonly Vec2[] }> = []

  for (const start of halfEdges) {
    if (visited[start.id]) continue
    const spans: BoundarySpan[] = []
    let he = start
    let guard = 0
    do {
      visited[he.id] = true
      spans.push(he.span)
      he = next(he)
    } while (he.id !== start.id && ++guard < halfEdges.length + 1)

    const signed = ringSignedArea(spans, segmentsById, tol)
    if (signed > AREA_EPS) ccw.push(spans)
    else if (signed < -AREA_EPS) cw.push({ spans, ring: ringFromSpans(spans, segmentsById, tol) })
  }

  return { ccw, cw }
}

/** Merge cycles from every component into one raw set. */
export function mergeCycles(parts: readonly RawCycles[]): RawCycles {
  return {
    ccw: parts.flatMap((p) => p.ccw),
    cw: parts.flatMap((p) => p.cw),
  }
}

function segmentSet(spans: readonly BoundarySpan[]): Set<string> {
  return new Set(spans.map((s) => s.segmentId))
}

function disjoint(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const s of a) if (b.has(s)) return false
  return true
}

/**
 * Assign each clockwise void ring to the smallest CCW face that contains it (a hole). A
 * clockwise cycle is a hole only when it comes from a **different** connected component than
 * the face: a component's own outer boundary is traced clockwise too and shares every edge
 * with its interior faces, so requiring disjoint segment sets discards that outer boundary
 * (and, at the top level, the unbounded face) while keeping genuine disconnected islands.
 */
function nestHoles(
  raw: RawCycles,
  segmentsById: ReadonlyMap<string, PieceSegment>,
  tol: number,
): FaceGeom[] {
  const rings = raw.ccw.map((outer) => ringFromSpans(outer, segmentsById, tol))
  const faceSegs = raw.ccw.map(segmentSet)
  const areas = rings.map((r) => Math.abs(shoelace(r)))
  const holesByFace = raw.ccw.map(() => [] as (readonly BoundarySpan[])[])

  for (const cwCycle of raw.cw) {
    if (cwCycle.ring.length < 3) continue
    const cwSegs = segmentSet(cwCycle.spans)
    const probe = cwCycle.ring[0]!
    let best = -1
    for (let i = 0; i < raw.ccw.length; i++) {
      if (!disjoint(cwSegs, faceSegs[i]!) || !pointInRing(rings[i]!, probe)) continue
      if (best === -1 || areas[i]! < areas[best]!) best = i
    }
    if (best !== -1) holesByFace[best]!.push(cwCycle.spans)
  }

  return raw.ccw.map((outer, i) => ({ outer, holes: holesByFace[i]! }))
}

function shoelace(ring: readonly Vec2[]): number {
  let sum = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % n]!
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

/**
 * Keep only faces inside the border contour (Scope: "faces outside the border contour are
 * not pieces"). `borderRings` are the interior rings of the border-only subgraph; a face is
 * kept when a representative interior point lies inside one of them. With no border rings
 * (no border, or an open one) every face is kept.
 */
export function filterByBorder(
  faces: readonly FaceGeom[],
  borderRings: readonly (readonly Vec2[])[],
  segmentsById: ReadonlyMap<string, PieceSegment>,
  tol: number,
): FaceGeom[] {
  if (borderRings.length === 0) return [...faces]
  return faces.filter((f) => {
    const probe = interiorPoint(ringFromSpans(f.outer, segmentsById, tol))
    return borderRings.some((r) => pointInRing(r, probe))
  })
}

/** The interior rings of the border-only subgraph, used to clip faces to the border. */
export function borderInteriorRings(
  vertexCount: number,
  edges: readonly GraphEdge[],
  segmentsById: ReadonlyMap<string, PieceSegment>,
  tol: number,
): Vec2[][] {
  const borderEdges = edges.filter((e) => segmentsById.get(e.segmentId)?.role === 'border')
  if (borderEdges.length === 0) return []
  const raw = traceCycles(vertexCount, borderEdges, segmentsById, tol)
  return raw.ccw.map((outer) => ringFromSpans(outer, segmentsById, tol))
}

/**
 * Iteratively strip dangling edges (an endpoint of graph-degree 1) so spurs — which cannot
 * bound a piece — don't corrupt face boundaries. Returns the surviving edges.
 */
export function pruneDangling(graph: PlanarGraph): GraphEdge[] {
  const degree = [...graph.degree]
  const alive = new Set(graph.edges.map((e) => e.id))
  let changed = true
  while (changed) {
    changed = false
    for (const e of graph.edges) {
      if (!alive.has(e.id)) continue
      if (degree[e.from] === 1 || degree[e.to] === 1) {
        alive.delete(e.id)
        degree[e.from]!--
        degree[e.to]!--
        changed = true
      }
    }
  }
  return graph.edges.filter((e) => alive.has(e.id))
}

/** Full face extraction for a whole graph: trace, nest holes, clip to the border. */
export function tracePieces(graph: PlanarGraph, tol: number): FaceGeom[] {
  const edges = pruneDangling(graph)
  const raw = traceCycles(graph.vertices.length, edges, graph.segmentsById, tol)
  const faces = nestHoles(raw, graph.segmentsById, tol)
  const borderRings = borderInteriorRings(graph.vertices.length, edges, graph.segmentsById, tol)
  return filterByBorder(faces, borderRings, graph.segmentsById, tol)
}

/** Assemble faces from already-traced raw cycles (the incremental path). */
export function assembleFaces(
  raw: RawCycles,
  vertexCount: number,
  edges: readonly GraphEdge[],
  segmentsById: ReadonlyMap<string, PieceSegment>,
  tol: number,
): FaceGeom[] {
  const faces = nestHoles(raw, segmentsById, tol)
  const borderRings = borderInteriorRings(vertexCount, edges, segmentsById, tol)
  return filterByBorder(faces, borderRings, segmentsById, tol)
}
