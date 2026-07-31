import {
  arcEnd,
  arcStart,
  arcToCubics,
  cubic,
  isSimilarity,
  line,
  transformShape,
  type Arc,
  type Transform2D,
  type Vec2,
} from '@vitrum/geometry'

import { newNodeId, newSegmentId } from './ids'
import type { Node, NodeId, Project, Segment, SegmentGeometry, SegmentId } from './types'

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
 * Return a copy of a **line or cubic** `geometry` with endpoint `which` (0 = start, 1 = end)
 * moved to `pos`, leaving the other endpoint and any interior handles untouched. Arcs are not
 * accepted: an arc cannot keep an endpoint off its circle, so it is demoted to a cubic chain
 * at the segment level ({@link demoteArcSegment}) before any endpoint moves — passing one here
 * is a bug.
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
    case 'arc':
      throw new Error('setGeometryEndpoint: demote the arc to cubics before moving an endpoint')
  }
}

/** True when transforming `geometry` under `t` keeps its kind (a similarity keeps arcs). */
export function keepsKind(geometry: SegmentGeometry, t: Transform2D): boolean {
  return geometry.kind !== 'arc' || isSimilarity(t)
}

/**
 * Transform a **kind-preserving** segment geometry (a line/cubic, or an arc under a
 * similarity). Arcs under a reflection or non-uniform scale must be demoted first via
 * {@link demoteArcSegment}; call {@link keepsKind} to decide. Throws otherwise.
 */
export function transformGeometry(geometry: SegmentGeometry, t: Transform2D): SegmentGeometry {
  if (!keepsKind(geometry, t)) {
    throw new Error('transformGeometry: demote the arc to cubics before a non-similarity transform')
  }
  return transformShape(t, geometry) as SegmentGeometry
}

/**
 * Deterministic ids for demoting one arc segment into a chain of `count` cubic spans. The
 * first span **reuses** the arc's own segment id (so nothing else needs re-pointing); the
 * rest, plus the `count − 1` interior junction nodes, get ids derived from the arc's id.
 * Determinism matters: `moveNode` re-applies its patch on redo, and the coalesced inverse
 * must reference the *same* generated ids it produced during the live drag.
 */
export function arcDemotionIds(
  segmentId: SegmentId,
  count: number,
): { readonly segmentIds: string[]; readonly nodeIds: string[] } {
  const segmentIds = [segmentId]
  const nodeIds: string[] = []
  for (let i = 1; i < count; i++) {
    segmentIds.push(`${segmentId}~c${i}`)
    nodeIds.push(`${segmentId}~n${i}`)
  }
  return { segmentIds, nodeIds }
}

/**
 * Demote an arc segment into a welded chain of ≤90° cubic spans (F-013, adaptive multi-cubic
 * rule): a quarter-circle → 1 cubic, a semicircle → 2, a full circle → 4, so every arched top
 * or circular motif stays visually faithful when edited or mirrored. The chain's outer
 * endpoints keep the arc's original endpoint node ids (pinned to `startPos`/`endPos` exactly);
 * interior joins are fresh shared nodes, so FR-1 holds across the whole chain. Ids are
 * deterministic ({@link arcDemotionIds}).
 */
export function demoteArcSegment(
  segment: Segment & { readonly geometry: Arc },
  startPos: Vec2,
  endPos: Vec2,
): { segments: Segment[]; nodes: Record<NodeId, Node> } {
  const cubics = arcToCubics(segment.geometry)
  const n = cubics.length
  const { segmentIds, nodeIds } = arcDemotionIds(segment.id, n)

  // Boundary points: pin the outer ends to the exact node positions; interior joins are the
  // shared span endpoints (one object each, so adjacent spans weld bit-identically).
  const boundary: Vec2[] = new Array<Vec2>(n + 1)
  boundary[0] = startPos
  boundary[n] = endPos
  for (let i = 1; i < n; i++) boundary[i] = cubics[i - 1]!.p3

  const segments: Segment[] = []
  const nodes: Record<NodeId, Node> = {}
  for (let i = 0; i < n; i++) {
    const c = cubics[i]!
    const geometry = cubic(boundary[i]!, c.p1, c.p2, boundary[i + 1]!)
    const startNode = i === 0 ? segment.endpoints[0] : nodeIds[i - 1]!
    const endNode = i === n - 1 ? segment.endpoints[1] : nodeIds[i]!
    segments.push({
      id: segmentIds[i]!,
      geometry,
      role: segment.role,
      endpoints: [startNode, endNode],
    })
  }
  for (let i = 1; i < n; i++) nodes[nodeIds[i - 1]!] = { pos: boundary[i]! }
  return { segments, nodes }
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

/**
 * Turn drawing-tool drafts into segments ready for `addSegments`, welding endpoints two ways
 * (F-013): endpoints coincident **within the gesture** share a fresh node, and an endpoint that
 * lands *exactly* on an **existing** project node (F-012 endpoint-snap returns the node's exact
 * coordinate) reuses that node id — so drawing onto a junction welds to it instead of stacking a
 * duplicate. Fresh segment/node ids are minted here (the impure step kept out of commands).
 */
export function segmentsFromDrafts(
  drafts: readonly { readonly geometry: SegmentGeometry; readonly role: Segment['role'] }[],
  existingNodes: Readonly<Record<NodeId, Node>>,
  /**
   * Node ids to use at specific positions, keyed by {@link vecKey}. Lets a caller pre-commit a
   * junction node the same gesture is about to create — a T-junction split (see `junctions.ts`)
   * mints the node id, and the endpoint landing there must reference that exact id.
   */
  pinnedByKey?: ReadonlyMap<string, NodeId>,
): Segment[] {
  const existingByKey = new Map<string, NodeId>()
  for (const [id, node] of Object.entries(existingNodes)) existingByKey.set(vecKey(node.pos), id)
  const localByKey = new Map<string, NodeId>()

  const nodeFor = (pos: Vec2): NodeId => {
    const key = vecKey(pos)
    const pinned = pinnedByKey?.get(key)
    if (pinned) return pinned
    const existing = existingByKey.get(key)
    if (existing) return existing
    const local = localByKey.get(key)
    if (local) return local
    const id = newNodeId()
    localByKey.set(key, id)
    return id
  }

  return drafts.map((draft) => {
    const [s, e] = geometryEndpoints(draft.geometry)
    return {
      id: newSegmentId(),
      geometry: draft.geometry,
      role: draft.role,
      endpoints: [nodeFor(s), nodeFor(e)],
    }
  })
}

/** Exact-equality key for welding endpoints; `-0` folds to `0` so it matches JSON. */
export function vecKey(v: Vec2): string {
  return `${v.x === 0 ? 0 : v.x},${v.y === 0 ? 0 : v.y}`
}

function vecEqual(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y
}
