import { curveLength } from '@vitrum/geometry'

import { collectDiagnostics } from './diagnostics'
import {
  assembleFaces,
  mergeCycles,
  pruneDangling,
  traceCycles,
  tracePieces,
  type FaceGeom,
  type RawCycles,
} from './faces'
import { buildGraph, type GraphEdge, type PlanarGraph } from './graph'
import { contentId, matchIds } from './identity'
import { buildPiece } from './properties'
import {
  DETECT_DEFAULTS,
  type BoundarySpan,
  type DetectionResult,
  type DetectOptions,
  type Piece,
  type PieceSegment,
} from './types'

/**
 * F-020 detection entry points. `detectPieces` is the full, authoritative recompute (the
 * correctness reference of FR-4). `PieceDetector` adds an incremental path that caches each
 * connected component's traced cycles and re-runs only the cheap global assembly + identity
 * pass on edit — so redrawing one line doesn't retrace the whole document (FR-5).
 */

interface Resolved {
  readonly weld: number
  readonly nearMiss: number
  readonly flatten: number
}

function resolve(options: DetectOptions): Resolved {
  return {
    weld: options.weldTolerance ?? DETECT_DEFAULTS.weldTolerance,
    nearMiss: options.nearMissTolerance ?? DETECT_DEFAULTS.nearMissTolerance,
    flatten: options.flattenTolerance ?? DETECT_DEFAULTS.flattenTolerance,
  }
}

function spanKey(s: BoundarySpan): string {
  return `${s.segmentId}:${s.tStart}:${s.tEnd}`
}

/** Rotate a cycle of spans so it starts at its lexicographically smallest span. */
function rotateToCanonicalStart(spans: readonly BoundarySpan[]): BoundarySpan[] {
  if (spans.length <= 1) return [...spans]
  let min = 0
  for (let i = 1; i < spans.length; i++) {
    if (spanKey(spans[i]!) < spanKey(spans[min]!)) min = i
  }
  return [...spans.slice(min), ...spans.slice(0, min)]
}

/**
 * Canonicalize a face so trace-start rotation and hole discovery order don't leak into the
 * output. Both the full and incremental paths run the same global `buildGraph`, so span
 * parameters are bit-identical; canonicalizing rotation/order makes the two paths produce
 * byte-identical pieces (and identical cold ids), which is what FR-4 asserts.
 */
function canonicalFace(face: FaceGeom): FaceGeom {
  const holes = face.holes
    .map(rotateToCanonicalStart)
    .sort((a, b) => (spanKey(a[0]!) < spanKey(b[0]!) ? -1 : 1))
  return { outer: rotateToCanonicalStart(face.outer), holes }
}

function buildWithId(
  face: FaceGeom,
  segmentsById: ReadonlyMap<string, PieceSegment>,
  flatten: number,
): Piece {
  const canonical = canonicalFace(face)
  const piece = buildPiece('', canonical.outer, canonical.holes, segmentsById, flatten)
  return { ...piece, id: contentId(piece.ring) }
}

/**
 * A canonical, trace-order-independent ordering so the full and incremental paths hand the
 * identity matcher an identical array (which is what makes FR-4's "identical output" hold).
 * Congruent pieces never share a centroid — they occupy different regions — so
 * centroid → area → cold-id is a total order.
 */
function canonicalSort(pieces: Piece[]): Piece[] {
  return [...pieces].sort(
    (a, b) =>
      a.centroid.x - b.centroid.x ||
      a.centroid.y - b.centroid.y ||
      a.area - b.area ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

function outputForDiagnostics(segments: readonly PieceSegment[], weld: number): PieceSegment[] {
  return segments.filter((s) => s.role !== 'construction' && curveLength(s.geometry) > weld)
}

/** Full, authoritative piece detection for a network. */
export function detectPieces(
  segments: readonly PieceSegment[],
  options: DetectOptions = {},
): DetectionResult {
  const { weld, nearMiss, flatten } = resolve(options)
  const graph = buildGraph(segments, weld)
  const faces = tracePieces(graph, weld)

  let pieces = canonicalSort(faces.map((f) => buildWithId(f, graph.segmentsById, flatten)))
  if (options.previous) pieces = matchIds(pieces, options.previous)

  const diagnostics = collectDiagnostics(
    graph,
    outputForDiagnostics(segments, weld),
    weld,
    nearMiss,
  )
  return { pieces, diagnostics }
}

/** One connected component: the graph edges reachable from each other via shared vertices. */
interface Component {
  readonly key: string
  readonly edges: GraphEdge[]
}

function geometryHash(seg: PieceSegment): string {
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
 * Partition pruned edges into connected components (union-find over vertices). A component's
 * cycles depend only on its own segments' geometry: any segment that crosses or touches it
 * shares a split vertex and so joins the same component. Its key therefore fully determines
 * its traced cycles, which is what makes cache reuse across edits exact.
 */
function componentsOf(
  edges: readonly GraphEdge[],
  vertexCount: number,
  segmentsById: ReadonlyMap<string, PieceSegment>,
): Component[] {
  const parent = Array.from({ length: vertexCount }, (_, i) => i)
  const find = (x: number): number => {
    let root = x
    while (parent[root] !== root) root = parent[root]!
    while (parent[x] !== root) {
      const nextX = parent[x]!
      parent[x] = root
      x = nextX
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[ra] = rb
  }
  for (const e of edges) union(e.from, e.to)

  const byRoot = new Map<number, GraphEdge[]>()
  for (const e of edges) {
    const root = find(e.from)
    const list = byRoot.get(root)
    if (list) list.push(e)
    else byRoot.set(root, [e])
  }

  return [...byRoot.values()].map((compEdges) => {
    const ids = new Set(compEdges.map((e) => e.segmentId))
    const key = [...ids]
      .map((id) => {
        const seg = segmentsById.get(id)
        return seg ? `${id}#${geometryHash(seg)}` : id
      })
      .sort()
      .join('|')
    return { key, edges: compEdges }
  })
}

/**
 * Incremental piece detector. Holds a per-component cycle cache and the previous generation;
 * `update` reuses unchanged components' cycles verbatim and matches ids against the prior
 * result so piece identity is stable across a drawing session (FR-3). Output is identical to
 * a full `detectPieces` with the same previous generation (FR-4).
 */
export class PieceDetector {
  #cache = new Map<string, RawCycles>()
  #previous: readonly Piece[] = []

  /** Recompute pieces for the current network, reusing unchanged components. */
  update(segments: readonly PieceSegment[], options: DetectOptions = {}): DetectionResult {
    const { weld, nearMiss, flatten } = resolve(options)
    const graph = buildGraph(segments, weld)
    const edges = pruneDangling(graph)
    const components = componentsOf(edges, graph.vertices.length, graph.segmentsById)

    const nextCache = new Map<string, RawCycles>()
    const parts: RawCycles[] = []
    for (const component of components) {
      let raw = this.#cache.get(component.key)
      if (!raw) raw = traceCycles(graph.vertices.length, component.edges, graph.segmentsById, weld)
      nextCache.set(component.key, raw)
      parts.push(raw)
    }

    const faces = assembleFaces(
      mergeCycles(parts),
      graph.vertices.length,
      edges,
      graph.segmentsById,
      weld,
    )
    const previous = options.previous ?? this.#previous
    const pieces = matchIds(
      canonicalSort(faces.map((f) => buildWithId(f, graph.segmentsById, flatten))),
      previous,
    )
    const diagnostics = collectDiagnostics(
      graph,
      outputForDiagnostics(segments, weld),
      weld,
      nearMiss,
    )

    this.#cache = nextCache
    this.#previous = pieces
    return { pieces, diagnostics }
  }

  /** Discard cached state (e.g. on loading a new document). */
  reset(): void {
    this.#cache = new Map()
    this.#previous = []
  }
}

export type { PlanarGraph }
