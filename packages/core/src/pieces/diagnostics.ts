import { bboxOf, bboxOverlap, closestPoint, distance, pointAt } from '@vitrum/geometry'

import { GridIndex } from '../snap/spatialIndex'
import type { PlanarGraph } from './graph'
import type { Diagnostic, PieceSegment } from './types'

/**
 * Diagnostics for imperfect networks (Scope; doubles as the ERC input for F-030). All are
 * reported as data with locations and, for near-misses, the measured gap — detection never
 * mutates the document to fix them (Mathieu, 2026-07-18: "report, never mutate").
 */

/** Endpoints of degree 1 in the split graph that don't sit on the border are free ends. */
function danglingEnds(
  graph: PlanarGraph,
  borderSegments: readonly PieceSegment[],
  tol: number,
): Diagnostic[] {
  const incident = new Map<number, string>()
  for (const e of graph.edges) {
    if (graph.degree[e.from] === 1) incident.set(e.from, e.segmentId)
    if (graph.degree[e.to] === 1) incident.set(e.to, e.segmentId)
  }
  const out: Diagnostic[] = []
  for (const [vertex, segmentId] of incident) {
    const at = graph.vertices[vertex]!
    const onBorder = borderSegments.some((b) => closestPoint(b.geometry, at).distance <= tol)
    if (onBorder) continue
    out.push({
      kind: 'dangling-end',
      at,
      segmentIds: [segmentId],
      message: 'segment end is not connected to the network',
    })
  }
  return out
}

/** Endpoints closer than `nearMiss` but not welded (different nodes, gap above `weld`). */
function nearMisses(
  segments: readonly PieceSegment[],
  weld: number,
  nearMiss: number,
): Diagnostic[] {
  const ends = segments.flatMap((s) => [
    { pos: pointAt(s.geometry, 0), node: s.endpoints[0], segmentId: s.id },
    { pos: pointAt(s.geometry, 1), node: s.endpoints[1], segmentId: s.id },
  ])
  const out: Diagnostic[] = []
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i]!
      const b = ends[j]!
      if (a.node === b.node) continue
      const d = distance(a.pos, b.pos)
      if (d > weld && d <= nearMiss) {
        out.push({
          kind: 'near-miss',
          at: { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 },
          segmentIds: [a.segmentId, b.segmentId],
          distance: d,
          message: `endpoints ${d.toFixed(3)} mm apart are not welded`,
        })
      }
    }
  }
  return out
}

function samplesMatch(a: PieceSegment, b: PieceSegment, tol: number): boolean {
  for (const t of [0.1, 0.35, 0.6, 0.85]) {
    if (closestPoint(b.geometry, pointAt(a.geometry, t)).distance > tol) return false
  }
  return true
}

/** Segments that duplicate or overlap another (same path over a shared, non-trivial span). */
function duplicates(segments: readonly PieceSegment[], tol: number): Diagnostic[] {
  const boxes = segments.map((s) => bboxOf(s.geometry))
  const index = GridIndex.build(boxes)
  const out: Diagnostic[] = []
  const seen = new Set<string>()
  for (let i = 0; i < segments.length; i++) {
    for (const j of index.query(boxes[i]!)) {
      if (j <= i || !bboxOverlap(boxes[i]!, boxes[j]!, tol)) continue
      const a = segments[i]!
      const b = segments[j]!
      // Symmetric containment of interior samples ⇒ the two trace the same curve (fully or
      // one within the other) — an exact duplicate or an overlapping run of lead.
      if (samplesMatch(a, b, tol) || samplesMatch(b, a, tol)) {
        const key = `${a.id}|${b.id}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          kind: 'duplicate-segment',
          at: pointAt(a.geometry, 0.5),
          segmentIds: [a.id, b.id],
          message: 'segment overlaps another segment',
        })
      }
    }
  }
  return out
}

function sortKey(d: Diagnostic): string {
  const ids = [...d.segmentIds].sort().join(',')
  return `${d.kind}|${d.at.x.toFixed(6)}|${d.at.y.toFixed(6)}|${ids}`
}

/**
 * All network diagnostics for the given output segments and their planar graph. Segment ids
 * within each diagnostic and the list itself are sorted canonically, so the output is a
 * deterministic function of the network regardless of input segment order (FR-2).
 */
export function collectDiagnostics(
  graph: PlanarGraph,
  segments: readonly PieceSegment[],
  weld: number,
  nearMiss: number,
): Diagnostic[] {
  const borderSegments = segments.filter((s) => s.role === 'border')
  return [
    ...danglingEnds(graph, borderSegments, weld),
    ...nearMisses(segments, weld, nearMiss),
    ...duplicates(segments, weld),
  ]
    .map((d) => ({ ...d, segmentIds: [...d.segmentIds].sort() }))
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0))
}
