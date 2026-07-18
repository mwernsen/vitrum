import {
  arcEnd,
  arcStart,
  arcToCubic,
  cubic,
  isSimilarity,
  line,
  transformShape,
  type Transform2D,
  type Vec2,
} from '@vitrum/geometry'

import { newNodeId } from './ids'
import type { Node, NodeId, Project, Segment, SegmentGeometry } from './types'

/**
 * Node bookkeeping for the stored-node model (F-013, resolved Open question — Option B).
 * Nodes are the authoritative junction positions; segment endpoints reference them by id,
 * and welded endpoints share one id. The helpers here keep the two structural invariants
 * every command must preserve:
 *
 * - I1/I3: `Project.nodes` holds exactly the node ids referenced by segment endpoints
 *   (no dangling refs, no orphan nodes).
 * - I2: for each segment, the referenced node's `pos` is **bit-identical** to the matching
 *   geometry endpoint — so a weld can never drift apart (FR-1).
 *
 * Pure and DOM-free; depends only on `@vitrum/geometry`.
 */

/** The `[start, end]` world points of a segment's geometry (arc endpoints are computed). */
export function geometryEndpoints(geometry: SegmentGeometry): readonly [Vec2, Vec2] {
  switch (geometry.kind) {
    case 'line':
      return [geometry.a, geometry.b]
    case 'cubic':
      return [geometry.p0, geometry.p3]
    case 'arc':
      return [arcStart(geometry), arcEnd(geometry)]
  }
}

/**
 * Return a copy of `geometry` with endpoint `which` (0 = start, 1 = end) moved to `pos`,
 * leaving the other endpoint and any interior handles untouched. An `Arc` cannot keep an
 * endpoint off its circle, so it is **demoted to a single free cubic** first (the resolved
 * arc-containment rule): the demoted cubic matches the arc's endpoints and tangents, then
 * the requested endpoint is set. Lines and cubics are edited directly and exactly.
 */
export function setGeometryEndpoint(
  geometry: SegmentGeometry,
  which: 0 | 1,
  pos: Vec2,
): SegmentGeometry {
  switch (geometry.kind) {
    case 'line':
      return which === 0 ? line(pos, geometry.b) : line(geometry.a, pos)
    case 'cubic':
      return which === 0
        ? cubic(pos, geometry.p1, geometry.p2, geometry.p3)
        : cubic(geometry.p0, geometry.p1, geometry.p2, pos)
    case 'arc': {
      const c = arcToCubic(geometry)
      return which === 0 ? cubic(pos, c.p1, c.p2, c.p3) : cubic(c.p0, c.p1, c.p2, pos)
    }
  }
}

/**
 * Transform a segment's geometry, demoting an `Arc` to a cubic when the transform is not
 * an orientation-preserving similarity (a reflection or non-uniform scale would make a
 * circular arc elliptical or flip its winding — F-013 mirror). Lines and cubics transform
 * exactly under any affine.
 */
export function transformGeometry(geometry: SegmentGeometry, t: Transform2D): SegmentGeometry {
  if (geometry.kind === 'arc' && !isSimilarity(t)) {
    return transformShape(t, arcToCubic(geometry)) as SegmentGeometry
  }
  return transformShape(t, geometry) as SegmentGeometry
}

/** Every segment that references `nodeId` at either endpoint, with which end it is. */
export function incidentEndpoints(
  segments: Readonly<Record<string, Segment>>,
  nodeId: NodeId,
): readonly { readonly segment: Segment; readonly which: 0 | 1 }[] {
  const out: { segment: Segment; which: 0 | 1 }[] = []
  for (const segment of Object.values(segments)) {
    if (segment.endpoints[0] === nodeId) out.push({ segment, which: 0 })
    if (segment.endpoints[1] === nodeId) out.push({ segment, which: 1 })
  }
  return out
}

/** The set of node ids referenced by any segment endpoint. */
export function referencedNodeIds(segments: Readonly<Record<string, Segment>>): Set<NodeId> {
  const ids = new Set<NodeId>()
  for (const segment of Object.values(segments)) {
    ids.add(segment.endpoints[0])
    ids.add(segment.endpoints[1])
  }
  return ids
}

/**
 * Rebuild the node map so it holds exactly the ids referenced by `segments` (I1/I3).
 * Existing nodes keep their authoritative `pos`; a node first introduced by `addedSegments`
 * takes its position from that segment's geometry endpoint. Throws if an added segment
 * references an existing node whose position does not match its geometry endpoint (I2) —
 * a construction bug the caller must fix rather than silently drift a weld.
 */
export function reconcileNodes(
  segments: Readonly<Record<string, Segment>>,
  priorNodes: Readonly<Record<NodeId, Node>>,
  addedSegments: readonly Segment[] = [],
): Record<NodeId, Node> {
  // Positions offered by the added segments, keyed by node id.
  const offered = new Map<NodeId, Vec2>()
  for (const segment of addedSegments) {
    const [s, e] = geometryEndpoints(segment.geometry)
    offered.set(segment.endpoints[0], s)
    offered.set(segment.endpoints[1], e)
  }

  const referenced = referencedNodeIds(segments)
  const next: Record<NodeId, Node> = {}
  for (const id of referenced) {
    const existing = priorNodes[id]
    if (existing) {
      const pos = offered.get(id)
      if (pos && !vecEqual(existing.pos, pos)) {
        throw new Error(
          `reconcileNodes: segment endpoint at node ${id} does not match the node position`,
        )
      }
      next[id] = existing
      continue
    }
    const pos = offered.get(id)
    if (!pos) throw new Error(`reconcileNodes: no position for new node ${id}`)
    next[id] = { pos }
  }
  return next
}

/** Rebuild a project's node map from its segments (deriving positions from geometry). */
export function reconcileProjectNodes(project: Project): Project {
  return {
    ...project,
    nodes: reconcileNodes(project.segments, {}, Object.values(project.segments)),
  }
}

/**
 * Weld a set of geometry-only segments into a node network: endpoints with bit-identical
 * coordinates share one fresh node id. This is the coincidence → stored-node synthesis the
 * v1→v2 migration runs over legacy files, and the same welding the drawing-tool commit path
 * reuses. `mint` defaults to {@link newNodeId}; tests inject a deterministic minter.
 */
export function synthesizeNodes(
  raw: readonly {
    readonly id: string
    readonly geometry: SegmentGeometry
    readonly role: Segment['role']
  }[],
  mint: () => NodeId = newNodeId,
): { segments: Record<string, Segment>; nodes: Record<NodeId, Node> } {
  const byKey = new Map<string, NodeId>()
  const nodes: Record<NodeId, Node> = {}
  const segments: Record<string, Segment> = {}

  const nodeFor = (pos: Vec2): NodeId => {
    const key = vecKey(pos)
    const existing = byKey.get(key)
    if (existing) return existing
    const id = mint()
    byKey.set(key, id)
    nodes[id] = { pos }
    return id
  }

  for (const item of raw) {
    const [s, e] = geometryEndpoints(item.geometry)
    segments[item.id] = {
      id: item.id,
      geometry: item.geometry,
      role: item.role,
      endpoints: [nodeFor(s), nodeFor(e)],
    }
  }
  return { segments, nodes }
}

/** Exact-equality key for welding endpoints; `-0` folds to `0` so it matches JSON. */
export function vecKey(v: Vec2): string {
  return `${v.x === 0 ? 0 : v.x},${v.y === 0 ? 0 : v.y}`
}

function vecEqual(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y
}
