import { applyToPoint, splitAt, type Transform2D, type Vec2 } from '@vitrum/geometry'

import {
  geometryEndpoints,
  incidentEndpoints,
  reconcileNodes,
  setGeometryEndpoint,
  transformGeometry,
} from './nodes'
import type {
  Node,
  NodeId,
  Project,
  ProjectSettings,
  Segment,
  SegmentGeometry,
  SegmentId,
  SegmentRole,
} from './types'

/**
 * The command pattern (F-002 FR-1). Every mutation of a `Project` is a `Command`:
 *
 * - `apply`   — a pure forward transform `Project -> Project` (structural sharing).
 * - `invert`  — given the document *before* `apply` ran, produce the command that
 *   exactly reverses it. The store keeps this so undo is precise (FR-2) without
 *   snapshotting the whole document.
 * - `merge`   — optional. Coalesces a following command of the same interaction into
 *   one history entry (e.g. every mouse-move of a drag). Returns the combined forward
 *   command, or `undefined` to decline.
 *
 * Commands are kept *semantic* ("addSegment", "moveNode") rather than generic patches
 * so DRC (F-030) and versioning (F-055) can reason about intent. They are the ONLY way
 * to change a document — the store exposes no raw setters.
 */
export interface Command {
  readonly kind: string
  apply(doc: Project): Project
  invert(before: Project): Command
  merge?(next: Command): Command | undefined
}

/* -------------------------------------------------------------------------- */
/* Segment commands                                                            */
/* -------------------------------------------------------------------------- */

/** Add a new segment. Fails if its id is already present (ids are never reused). */
export function addSegment(segment: Segment): Command {
  return {
    kind: 'addSegment',
    apply: (doc) => {
      if (segment.id in doc.segments) {
        throw new Error(`addSegment: segment ${segment.id} already exists`)
      }
      const segments = { ...doc.segments, [segment.id]: segment }
      return { ...doc, segments, nodes: reconcileNodes(segments, doc.nodes, [segment]) }
    },
    invert: () => removeSegment(segment.id),
  }
}

/**
 * Add several segments as one atomic command — the whole of a drawing gesture (a
 * polyline chain, a shape's edges) so a single undo removes all of it, not one span
 * (F-011 FR-1). Fails if any id is already present (ids are never reused).
 */
export function addSegments(segments: readonly Segment[]): Command {
  return {
    kind: 'addSegments',
    apply: (doc) => {
      const next = { ...doc.segments }
      for (const segment of segments) {
        if (segment.id in next) {
          throw new Error(`addSegments: segment ${segment.id} already exists`)
        }
        next[segment.id] = segment
      }
      return { ...doc, segments: next, nodes: reconcileNodes(next, doc.nodes, segments) }
    },
    invert: () => removeSegments(segments.map((s) => s.id)),
  }
}

/**
 * Atomically remove some segments and add others in one command. Used by the border tool
 * (F-011) to replace the single border contour: remove the old border's segments and add
 * the new ones as one undo entry. Reversible exactly — its inverse re-adds whatever was
 * actually removed (read from the pre-state) and removes what was added.
 */
export function replaceSegments(removeIds: readonly SegmentId[], add: readonly Segment[]): Command {
  return {
    kind: 'replaceSegments',
    apply: (doc) => {
      const next = { ...doc.segments }
      for (const id of removeIds) delete next[id]
      for (const segment of add) {
        if (segment.id in next)
          throw new Error(`replaceSegments: segment ${segment.id} already exists`)
        next[segment.id] = segment
      }
      return { ...doc, segments: next, nodes: reconcileNodes(next, doc.nodes, add) }
    },
    invert: (before) => {
      // Re-add exactly the segments this command actually removed (present in `before`).
      const removed = removeIds
        .map((id) => before.segments[id])
        .filter((s): s is Segment => s !== undefined)
      return replaceSegments(
        add.map((s) => s.id),
        removed,
      )
    },
  }
}

/** Remove several segments as one command — the inverse of {@link addSegments}. */
export function removeSegments(ids: readonly SegmentId[]): Command {
  return {
    kind: 'removeSegments',
    apply: (doc) => {
      let segments = doc.segments
      for (const id of ids) {
        if (!(id in segments)) throw new Error(`removeSegments: segment ${id} does not exist`)
        segments = withoutSegment(segments, id)
      }
      return { ...doc, segments, nodes: reconcileNodes(segments, doc.nodes) }
    },
    invert: (before) => {
      const restored = ids.map((id) => {
        const segment = before.segments[id]
        if (!segment) throw new Error(`removeSegments.invert: segment ${id} does not exist`)
        return segment
      })
      return addSegments(restored)
    },
  }
}

/** Remove an existing segment. */
export function removeSegment(id: SegmentId): Command {
  return {
    kind: 'removeSegment',
    apply: (doc) => {
      if (!(id in doc.segments)) {
        throw new Error(`removeSegment: segment ${id} does not exist`)
      }
      const segments = withoutSegment(doc.segments, id)
      return { ...doc, segments, nodes: reconcileNodes(segments, doc.nodes) }
    },
    invert: (before) => {
      const segment = before.segments[id]
      if (!segment) throw new Error(`removeSegment.invert: segment ${id} does not exist`)
      return addSegment(segment)
    },
  }
}

interface UpdateGeometryCommand extends Command {
  readonly kind: 'updateSegmentGeometry'
  readonly segmentId: SegmentId
  readonly geometry: SegmentGeometry
}

/**
 * Replace a segment's geometry (the "move node / edit curve" mutation). Consecutive
 * updates to the same segment within one interaction coalesce via `merge`, so a drag
 * becomes a single undo entry whose inverse restores the pre-drag geometry.
 */
export function updateSegmentGeometry(id: SegmentId, geometry: SegmentGeometry): Command {
  const command: UpdateGeometryCommand = {
    kind: 'updateSegmentGeometry',
    segmentId: id,
    geometry,
    apply: (doc) => {
      const segment = doc.segments[id]
      if (!segment) throw new Error(`updateSegmentGeometry: segment ${id} does not exist`)
      return { ...doc, segments: { ...doc.segments, [id]: { ...segment, geometry } } }
    },
    invert: (before) => {
      const segment = before.segments[id]
      if (!segment) throw new Error(`updateSegmentGeometry.invert: segment ${id} does not exist`)
      return updateSegmentGeometry(id, segment.geometry)
    },
    merge: (next) => {
      if (next.kind !== 'updateSegmentGeometry') return undefined
      const other = next as UpdateGeometryCommand
      if (other.segmentId !== id) return undefined
      // Net effect of the drag so far: jump straight to the latest geometry.
      return updateSegmentGeometry(id, other.geometry)
    },
  }
  return command
}

/** Change a segment's role (lead / construction / border). */
export function setSegmentRole(id: SegmentId, role: SegmentRole): Command {
  return {
    kind: 'setSegmentRole',
    apply: (doc) => {
      const segment = doc.segments[id]
      if (!segment) throw new Error(`setSegmentRole: segment ${id} does not exist`)
      return { ...doc, segments: { ...doc.segments, [id]: { ...segment, role } } }
    },
    invert: (before) => {
      const segment = before.segments[id]
      if (!segment) throw new Error(`setSegmentRole.invert: segment ${id} does not exist`)
      return setSegmentRole(id, segment.role)
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Node commands (F-013)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A low-level, exactly-invertible mutation of the node/segment maps: set or delete a batch
 * of nodes and segments. It is the primitive the structural node edits (split, merge,
 * transform) are expressed in — its `invert` reads the pre-state and restores every touched
 * id to exactly what it was (re-adding a deleted node, deleting an added one), so any patch
 * round-trips. Not exported: callers use the intent-named builders below, which construct a
 * patch from the current document so DRC/versioning can still reason about intent.
 */
interface NetworkPatch {
  readonly setNodes?: Readonly<Record<NodeId, Node>>
  readonly deleteNodes?: readonly NodeId[]
  readonly setSegments?: Readonly<Record<SegmentId, Segment>>
  readonly deleteSegments?: readonly SegmentId[]
}

function patchNetwork(patch: NetworkPatch, kind = 'patchNetwork'): Command {
  return {
    kind,
    apply: (doc) => {
      const nodes = { ...doc.nodes }
      for (const [id, node] of Object.entries(patch.setNodes ?? {})) nodes[id] = node
      for (const id of patch.deleteNodes ?? []) delete nodes[id]
      const segments = { ...doc.segments }
      for (const [id, seg] of Object.entries(patch.setSegments ?? {})) segments[id] = seg
      for (const id of patch.deleteSegments ?? []) delete segments[id]
      return { ...doc, nodes, segments }
    },
    invert: (before) => {
      const setNodes: Record<NodeId, Node> = {}
      const deleteNodes: NodeId[] = []
      for (const id of touchedIds(patch.setNodes, patch.deleteNodes)) {
        const prior = before.nodes[id]
        if (prior) setNodes[id] = prior
        else deleteNodes.push(id)
      }
      const setSegments: Record<SegmentId, Segment> = {}
      const deleteSegments: SegmentId[] = []
      for (const id of touchedIds(patch.setSegments, patch.deleteSegments)) {
        const prior = before.segments[id]
        if (prior) setSegments[id] = prior
        else deleteSegments.push(id)
      }
      return patchNetwork({ setNodes, deleteNodes, setSegments, deleteSegments }, kind)
    },
  }
}

function touchedIds(
  set: Readonly<Record<string, unknown>> | undefined,
  del: readonly string[] | undefined,
): Set<string> {
  const ids = new Set<string>(del ?? [])
  for (const id of Object.keys(set ?? {})) ids.add(id)
  return ids
}

interface MoveNodeCommand extends Command {
  readonly kind: 'moveNode'
  readonly nodeId: NodeId
  readonly pos: Vec2
}

/**
 * Move a node to `pos`, dragging every welded endpoint with it (F-013 FR-1). Each incident
 * segment's endpoint at this node is rewritten to `pos` exactly; an incident `Arc` demotes
 * to a free cubic (it can no longer stay circular). Mergeable, so a whole drag is one undo
 * step (mirroring `updateSegmentGeometry`): the kept inverse restores the pre-drag state —
 * including any arc that was demoted mid-drag — because it captures the document before the
 * drag began.
 */
export function moveNode(nodeId: NodeId, pos: Vec2): Command {
  const command: MoveNodeCommand = {
    kind: 'moveNode',
    nodeId,
    pos,
    apply: (doc) => {
      if (!(nodeId in doc.nodes)) throw new Error(`moveNode: node ${nodeId} does not exist`)
      const segments = { ...doc.segments }
      for (const segment of Object.values(doc.segments)) {
        let geometry = segment.geometry
        let changed = false
        if (segment.endpoints[0] === nodeId) {
          geometry = setGeometryEndpoint(geometry, 0, pos)
          changed = true
        }
        if (segment.endpoints[1] === nodeId) {
          geometry = setGeometryEndpoint(geometry, 1, pos)
          changed = true
        }
        if (changed) segments[segment.id] = { ...segment, geometry }
      }
      return { ...doc, nodes: { ...doc.nodes, [nodeId]: { pos } }, segments }
    },
    invert: (before) => {
      const node = before.nodes[nodeId]
      if (!node) throw new Error(`moveNode.invert: node ${nodeId} does not exist`)
      const geometries = incidentEndpoints(before.segments, nodeId).map(({ segment }) => ({
        id: segment.id,
        geometry: segment.geometry,
      }))
      return restoreNodeGeometry(nodeId, node.pos, dedupeGeometries(geometries))
    },
    merge: (next) => {
      if (next.kind !== 'moveNode') return undefined
      const other = next as MoveNodeCommand
      if (other.nodeId !== nodeId) return undefined
      return moveNode(nodeId, other.pos)
    },
  }
  return command
}

/** The inverse of a `moveNode`: restore a node's position and its incident geometries exactly. */
function restoreNodeGeometry(
  nodeId: NodeId,
  pos: Vec2,
  geometries: readonly { readonly id: SegmentId; readonly geometry: SegmentGeometry }[],
): Command {
  return {
    kind: 'restoreNodeGeometry',
    apply: (doc) => {
      const segments = { ...doc.segments }
      for (const { id, geometry } of geometries) {
        const seg = segments[id]
        if (seg) segments[id] = { ...seg, geometry }
      }
      return { ...doc, nodes: { ...doc.nodes, [nodeId]: { pos } }, segments }
    },
    invert: (before) => {
      const node = before.nodes[nodeId]
      if (!node) throw new Error(`restoreNodeGeometry.invert: node ${nodeId} does not exist`)
      const restored = geometries.map(({ id }) => ({
        id,
        geometry: before.segments[id]?.geometry ?? geometries.find((g) => g.id === id)!.geometry,
      }))
      return restoreNodeGeometry(nodeId, node.pos, restored)
    },
  }
}

function dedupeGeometries(
  geometries: readonly { readonly id: SegmentId; readonly geometry: SegmentGeometry }[],
): { readonly id: SegmentId; readonly geometry: SegmentGeometry }[] {
  const seen = new Map<SegmentId, SegmentGeometry>()
  for (const g of geometries) if (!seen.has(g.id)) seen.set(g.id, g.geometry)
  return [...seen].map(([id, geometry]) => ({ id, geometry }))
}

/**
 * Split `segmentId` at parameter `t`, inserting a node there (F-013 double-click-to-insert,
 * via the F-010 `splitAt`). The original segment becomes the first half; a new segment
 * (`newSegmentId`) is the second half; both weld to the fresh `midNodeId`. Ids are minted by
 * the caller so the command stays pure. Reversible: undo removes the new span and node and
 * restores the original segment.
 */
export function splitSegmentAtNode(
  segmentId: SegmentId,
  t: number,
  newSegmentId: SegmentId,
  midNodeId: NodeId,
): Command {
  return {
    kind: 'splitSegmentAtNode',
    apply: (doc) => {
      const seg = doc.segments[segmentId]
      if (!seg) throw new Error(`splitSegmentAtNode: segment ${segmentId} does not exist`)
      const [g1, g2] = splitAt(seg.geometry, t) as [SegmentGeometry, SegmentGeometry]
      const mid = geometryEndpoints(g1)[1]
      const seg1: Segment = { ...seg, geometry: g1, endpoints: [seg.endpoints[0], midNodeId] }
      const seg2: Segment = {
        id: newSegmentId,
        geometry: g2,
        role: seg.role,
        endpoints: [midNodeId, seg.endpoints[1]],
      }
      return patchNetwork(
        {
          setNodes: { [midNodeId]: { pos: mid } },
          setSegments: { [segmentId]: seg1, [newSegmentId]: seg2 },
        },
        'splitSegmentAtNode',
      ).apply(doc)
    },
    invert: (before) => {
      const original = before.segments[segmentId]
      if (!original)
        throw new Error(`splitSegmentAtNode.invert: segment ${segmentId} does not exist`)
      return patchNetwork(
        {
          setSegments: { [segmentId]: original },
          deleteSegments: [newSegmentId],
          deleteNodes: [midNodeId],
        },
        'splitSegmentAtNode',
      )
    },
  }
}

/**
 * Weld two nodes into one: every endpoint at `dropId` is re-pointed to `keepId` and moved to
 * `keepId`'s position (arcs demote), then `dropId` is removed. This is how dragging one node
 * onto another, or an explicit merge, coalesces a junction. Reversible.
 */
export function mergeNodes(keepId: NodeId, dropId: NodeId): Command {
  return {
    kind: 'mergeNodes',
    apply: (doc) => {
      if (keepId === dropId) throw new Error('mergeNodes: keep and drop are the same node')
      const keep = doc.nodes[keepId]
      if (!keep) throw new Error(`mergeNodes: node ${keepId} does not exist`)
      if (!(dropId in doc.nodes)) throw new Error(`mergeNodes: node ${dropId} does not exist`)
      const setSegments: Record<SegmentId, Segment> = {}
      for (const segment of Object.values(doc.segments)) {
        if (segment.endpoints[0] !== dropId && segment.endpoints[1] !== dropId) continue
        let geometry = segment.geometry
        const endpoints: [NodeId, NodeId] = [...segment.endpoints]
        if (endpoints[0] === dropId) {
          geometry = setGeometryEndpoint(geometry, 0, keep.pos)
          endpoints[0] = keepId
        }
        if (endpoints[1] === dropId) {
          geometry = setGeometryEndpoint(geometry, 1, keep.pos)
          endpoints[1] = keepId
        }
        setSegments[segment.id] = { ...segment, geometry, endpoints }
      }
      return patchNetwork({ setSegments, deleteNodes: [dropId] }, 'mergeNodes').apply(doc)
    },
    invert: (before) => {
      const drop = before.nodes[dropId]
      if (!drop) throw new Error(`mergeNodes.invert: node ${dropId} does not exist`)
      const setSegments: Record<SegmentId, Segment> = {}
      for (const segment of Object.values(before.segments)) {
        if (segment.endpoints[0] === dropId || segment.endpoints[1] === dropId) {
          setSegments[segment.id] = segment
        }
      }
      return patchNetwork({ setNodes: { [dropId]: drop }, setSegments }, 'mergeNodes')
    },
  }
}

/**
 * Delete a node and every segment incident to it (F-013 "delete node removes spans"). Far
 * endpoints left with no other segment become orphaned and are pruned by `removeSegments`,
 * so the network stays orphan-free. (Dissolving a 2-valent node by re-joining its spans is a
 * later refinement, noted in the spec.) Returns a no-op-safe `removeSegments`.
 */
export function deleteNode(project: Project, nodeId: NodeId): Command {
  const ids = incidentEndpoints(project.segments, nodeId).map(({ segment }) => segment.id)
  return removeSegments([...new Set(ids)])
}

/**
 * Apply an affine transform to a whole selection of segments (F-013 move/rotate/scale/mirror).
 * Every node the selection touches is transformed once, so welded junctions stay welded (FR-1);
 * selected segments are transformed in full (arcs demote to cubics under reflection or
 * non-uniform scale), and an unselected segment sharing a moved node has just that endpoint
 * follow, so the weld stretches rather than tears. Reversible via the patch primitive.
 */
export function transformSegments(
  project: Project,
  segmentIds: readonly SegmentId[],
  transform: Transform2D,
): Command {
  const selected = new Set(segmentIds)
  const touched = new Set<NodeId>()
  for (const id of segmentIds) {
    const seg = project.segments[id]
    if (!seg) throw new Error(`transformSegments: segment ${id} does not exist`)
    touched.add(seg.endpoints[0])
    touched.add(seg.endpoints[1])
  }

  const setNodes: Record<NodeId, Node> = {}
  for (const id of touched) {
    const node = project.nodes[id]
    if (node) setNodes[id] = { pos: applyToPoint(transform, node.pos) }
  }
  const posOf = (id: NodeId) => setNodes[id]?.pos ?? project.nodes[id]!.pos

  const setSegments: Record<SegmentId, Segment> = {}
  for (const seg of Object.values(project.segments)) {
    if (selected.has(seg.id)) {
      setSegments[seg.id] = { ...seg, geometry: transformGeometry(seg.geometry, transform) }
      continue
    }
    let geometry = seg.geometry
    let changed = false
    if (touched.has(seg.endpoints[0])) {
      geometry = setGeometryEndpoint(geometry, 0, posOf(seg.endpoints[0]))
      changed = true
    }
    if (touched.has(seg.endpoints[1])) {
      geometry = setGeometryEndpoint(geometry, 1, posOf(seg.endpoints[1]))
      changed = true
    }
    if (changed) setSegments[seg.id] = { ...seg, geometry }
  }
  return patchNetwork({ setNodes, setSegments }, 'transformSegments')
}

/* -------------------------------------------------------------------------- */
/* Settings commands                                                           */
/* -------------------------------------------------------------------------- */

/** Patch project settings. Pass `panelSize: undefined` to clear the panel size. */
export function updateSettings(patch: Partial<ProjectSettings>): Command {
  return {
    kind: 'updateSettings',
    apply: (doc) => ({ ...doc, settings: mergeSettings(doc.settings, patch) }),
    invert: (before) => replaceSettings(before.settings),
  }
}

/** Restore settings wholesale — the inverse of `updateSettings`. */
function replaceSettings(settings: ProjectSettings): Command {
  return {
    kind: 'replaceSettings',
    apply: (doc) => ({ ...doc, settings }),
    invert: (before) => replaceSettings(before.settings),
  }
}

function mergeSettings(base: ProjectSettings, patch: Partial<ProjectSettings>): ProjectSettings {
  const units = patch.units ?? base.units
  const name = patch.name ?? base.name
  const panelSize = 'panelSize' in patch ? patch.panelSize : base.panelSize
  return panelSize ? { units, name, panelSize } : { units, name }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function withoutSegment(
  segments: Readonly<Record<SegmentId, Segment>>,
  id: SegmentId,
): Record<SegmentId, Segment> {
  const next: Record<SegmentId, Segment> = {}
  for (const key of Object.keys(segments)) {
    const segment = segments[key]
    if (key !== id && segment) next[key] = segment
  }
  return next
}
