import {
  applyToPoint,
  isSimilarity,
  splitAt,
  transformShape,
  type Transform2D,
  type Vec2,
} from '@vitrum/geometry'

import {
  demoteArcSegment,
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

/**
 * Move a segment's endpoint(s) that sit at a `moves` node to the new position, demoting an
 * incident `Arc` into a welded cubic chain first (adaptive multi-cubic, F-013). `remap`
 * optionally re-points a moved node id to another (mergeNodes uses it to fold `dropId` into
 * `keepId`). Interior chain nodes are emitted at their demotion positions; the touched outer
 * span follows the new position. Accumulates into `setSegments`/`setNodes`.
 */
function emitMovedSegment(
  doc: Project,
  segment: Segment,
  moves: ReadonlyMap<NodeId, Vec2>,
  remap: ReadonlyMap<NodeId, NodeId>,
  setSegments: Record<SegmentId, Segment>,
  setNodes: Record<NodeId, Node>,
): void {
  if (!moves.has(segment.endpoints[0]) && !moves.has(segment.endpoints[1])) return
  const resolve = (id: NodeId): NodeId => remap.get(id) ?? id

  const spans =
    segment.geometry.kind === 'arc'
      ? demoteArcSegment(
          segment as Segment & { geometry: Extract<SegmentGeometry, { kind: 'arc' }> },
          doc.nodes[segment.endpoints[0]]!.pos,
          doc.nodes[segment.endpoints[1]]!.pos,
        )
      : { segments: [segment], nodes: {} as Record<NodeId, Node> }

  for (const [id, node] of Object.entries(spans.nodes)) setNodes[id] = node
  for (const span of spans.segments) {
    let geometry = span.geometry
    const endpoints: [NodeId, NodeId] = [...span.endpoints]
    const at0 = moves.get(span.endpoints[0])
    const at1 = moves.get(span.endpoints[1])
    if (at0) {
      geometry = setGeometryEndpoint(geometry, 0, at0)
      endpoints[0] = resolve(span.endpoints[0])
    }
    if (at1) {
      geometry = setGeometryEndpoint(geometry, 1, at1)
      endpoints[1] = resolve(span.endpoints[1])
    }
    setSegments[span.id] = { ...span, geometry, endpoints }
  }
}

/** The forward patch for a `moveNode`: move `nodeId` to `pos`, dragging every welded span. */
function moveNodePatch(doc: Project, nodeId: NodeId, pos: Vec2): NetworkPatch {
  if (!(nodeId in doc.nodes)) throw new Error(`moveNode: node ${nodeId} does not exist`)
  const setNodes: Record<NodeId, Node> = { [nodeId]: { pos } }
  const setSegments: Record<SegmentId, Segment> = {}
  const moves = new Map<NodeId, Vec2>([[nodeId, pos]])
  const noRemap = new Map<NodeId, NodeId>()
  for (const segment of Object.values(doc.segments)) {
    emitMovedSegment(doc, segment, moves, noRemap, setSegments, setNodes)
  }
  return { setNodes, setSegments }
}

interface MoveNodeCommand extends Command {
  readonly kind: 'moveNode'
  readonly nodeId: NodeId
}

/**
 * Move a node to `pos`, dragging every welded endpoint with it (F-013 FR-1). An incident arc
 * demotes to a welded cubic chain (adaptive ≤90° spans) that stays welded across its whole
 * length. Mergeable, so a whole drag is one undo step (mirroring `updateSegmentGeometry`): the
 * kept inverse restores the pre-drag state — including any arc demoted mid-drag — because both
 * `apply` and `invert` derive their patch from the same pre-apply document, and demotion ids
 * are deterministic so redo reproduces the drag exactly.
 */
export function moveNode(nodeId: NodeId, pos: Vec2): Command {
  const command: MoveNodeCommand = {
    kind: 'moveNode',
    nodeId,
    apply: (doc) => patchNetwork(moveNodePatch(doc, nodeId, pos), 'moveNode').apply(doc),
    invert: (before) => patchNetwork(moveNodePatch(before, nodeId, pos), 'moveNode').invert(before),
    merge: (next) => {
      if (next.kind !== 'moveNode') return undefined
      if ((next as MoveNodeCommand).nodeId !== nodeId) return undefined
      return next
    },
  }
  return command
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

/** The forward patch for a `mergeNodes`: fold `dropId` into `keepId`. */
function mergeNodesPatch(doc: Project, keepId: NodeId, dropId: NodeId): NetworkPatch {
  if (keepId === dropId) throw new Error('mergeNodes: keep and drop are the same node')
  const keep = doc.nodes[keepId]
  if (!keep) throw new Error(`mergeNodes: node ${keepId} does not exist`)
  if (!(dropId in doc.nodes)) throw new Error(`mergeNodes: node ${dropId} does not exist`)
  const setNodes: Record<NodeId, Node> = {}
  const setSegments: Record<SegmentId, Segment> = {}
  const moves = new Map<NodeId, Vec2>([[dropId, keep.pos]])
  const remap = new Map<NodeId, NodeId>([[dropId, keepId]])
  for (const segment of Object.values(doc.segments)) {
    emitMovedSegment(doc, segment, moves, remap, setSegments, setNodes)
  }
  return { setNodes, setSegments, deleteNodes: [dropId] }
}

/**
 * Weld two nodes into one: every endpoint at `dropId` is re-pointed to `keepId` and moved to
 * `keepId`'s position (an incident arc demotes to a cubic chain), then `dropId` is removed.
 * This is how dragging one node onto another, or an explicit merge, coalesces a junction.
 * Reversible.
 */
export function mergeNodes(keepId: NodeId, dropId: NodeId): Command {
  return {
    kind: 'mergeNodes',
    apply: (doc) => patchNetwork(mergeNodesPatch(doc, keepId, dropId), 'mergeNodes').apply(doc),
    invert: (before) =>
      patchNetwork(mergeNodesPatch(before, keepId, dropId), 'mergeNodes').invert(before),
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

/** The forward patch for a `transformSegments`. */
function transformPatch(
  doc: Project,
  segmentIds: readonly SegmentId[],
  t: Transform2D,
): NetworkPatch {
  const selected = new Set(segmentIds)
  const touched = new Set<NodeId>()
  for (const id of segmentIds) {
    const seg = doc.segments[id]
    if (!seg) throw new Error(`transformSegments: segment ${id} does not exist`)
    touched.add(seg.endpoints[0])
    touched.add(seg.endpoints[1])
  }

  const setNodes: Record<NodeId, Node> = {}
  for (const id of touched) setNodes[id] = { pos: applyToPoint(t, doc.nodes[id]!.pos) }
  const setSegments: Record<SegmentId, Segment> = {}

  // Selected segments transform in full. An arc under a reflection / non-uniform scale can no
  // longer stay circular, so it demotes to a cubic chain and every span is transformed.
  for (const id of selected) {
    const seg = doc.segments[id]!
    if (seg.geometry.kind === 'arc' && !isSimilarity(t)) {
      const chain = demoteArcSegment(
        seg as Segment & { geometry: Extract<SegmentGeometry, { kind: 'arc' }> },
        doc.nodes[seg.endpoints[0]]!.pos,
        doc.nodes[seg.endpoints[1]]!.pos,
      )
      for (const [nid, node] of Object.entries(chain.nodes)) {
        setNodes[nid] = { pos: applyToPoint(t, node.pos) }
      }
      for (const span of chain.segments) {
        setSegments[span.id] = {
          ...span,
          geometry: transformShape(t, span.geometry) as SegmentGeometry,
        }
      }
    } else {
      setSegments[id] = { ...seg, geometry: transformGeometry(seg.geometry, t) }
    }
  }

  // Unselected segments sharing a moved node let just that endpoint follow, so the weld
  // stretches rather than tears (an unselected arc demotes but keeps its interior shape).
  const moves = new Map<NodeId, Vec2>()
  for (const id of touched) moves.set(id, setNodes[id]!.pos)
  const noRemap = new Map<NodeId, NodeId>()
  for (const seg of Object.values(doc.segments)) {
    if (selected.has(seg.id)) continue
    emitMovedSegment(doc, seg, moves, noRemap, setSegments, setNodes)
  }
  return { setNodes, setSegments }
}

/**
 * Apply an affine transform to a whole selection of segments (F-013 move/rotate/scale/mirror).
 * Every node the selection touches is transformed once, so welded junctions stay welded (FR-1);
 * selected segments are transformed in full (arcs demote to a cubic chain under reflection or
 * non-uniform scale, staying visually faithful), and an unselected segment sharing a moved node
 * has just that endpoint follow, so the weld stretches rather than tears. Reversible.
 */
export function transformSegments(
  segmentIds: readonly SegmentId[],
  transform: Transform2D,
): Command {
  return {
    kind: 'transformSegments',
    apply: (doc) =>
      patchNetwork(transformPatch(doc, segmentIds, transform), 'transformSegments').apply(doc),
    invert: (before) =>
      patchNetwork(transformPatch(before, segmentIds, transform), 'transformSegments').invert(
        before,
      ),
  }
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
