import { newNodeId, newSegmentId } from './ids'
import { geometryEndpoints, synthesizeNodes } from './nodes'
import type { Node, NodeId, Segment, SegmentGeometry, SegmentRole } from './types'

/**
 * Build a segment with a fresh stable id and two fresh, unwelded endpoint nodes. Id
 * generation is isolated here (and in `ids.ts`) so commands stay pure: a tool calls
 * `createSegment`, then feeds the result to `addSegment`, keeping the impure step out of
 * the undoable command itself. The two endpoints get distinct node ids — use
 * {@link weldSegments} (or endpoint snapping at commit time) when endpoints must weld.
 */
export function createSegment(geometry: SegmentGeometry, role: SegmentRole = 'lead'): Segment {
  return { id: newSegmentId(), geometry, role, endpoints: [newNodeId(), newNodeId()] }
}

/**
 * Build a welded network from geometry drafts: endpoints with bit-identical coordinates
 * share one node id, so a chained gesture (a polyline, a closed shape) commits with its
 * junctions already welded (F-013 FR-1). Returns the segments plus the nodes they
 * introduce, ready for {@link addSegments}.
 */
export function weldSegments(
  drafts: readonly { readonly geometry: SegmentGeometry; readonly role: SegmentRole }[],
): { segments: Segment[]; nodes: Record<NodeId, Node> } {
  const raw = drafts.map((d) => ({ id: newSegmentId(), geometry: d.geometry, role: d.role }))
  const { segments, nodes } = synthesizeNodes(raw)
  return { segments: raw.map((r) => segments[r.id]!), nodes }
}

export { geometryEndpoints }
