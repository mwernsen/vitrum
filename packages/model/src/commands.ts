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
  CameOverride,
  CameProfile,
  CameProfileId,
  FoilSettings,
  LeadSettings,
  TechniqueKind,
  TechniqueSettings,
} from './technique'
import type {
  Glass,
  GlassId,
  Node,
  NodeId,
  PieceId,
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

interface UpdateGeometriesCommand extends Command {
  readonly kind: 'updateSegmentsGeometry'
  readonly updates: readonly { readonly id: SegmentId; readonly geometry: SegmentGeometry }[]
}

/**
 * Replace the geometry of several segments in one undoable step — the bézier-handle edit
 * (F-013), which can touch two segments at once when smoothing a shared node's tangents. Only
 * interior/handle geometry changes; endpoints (and therefore nodes) are untouched, so the weld
 * invariant holds. Mergeable across a drag when the same id set is edited, so one drag is one
 * undo entry (like {@link updateSegmentGeometry}).
 */
export function updateSegmentsGeometry(
  updates: readonly { readonly id: SegmentId; readonly geometry: SegmentGeometry }[],
): Command {
  const command: UpdateGeometriesCommand = {
    kind: 'updateSegmentsGeometry',
    updates,
    apply: (doc) => {
      const segments = { ...doc.segments }
      for (const { id, geometry } of updates) {
        const seg = segments[id]
        if (!seg) throw new Error(`updateSegmentsGeometry: segment ${id} does not exist`)
        segments[id] = { ...seg, geometry }
      }
      return { ...doc, segments }
    },
    invert: (before) =>
      updateSegmentsGeometry(
        updates.map(({ id }) => {
          const seg = before.segments[id]
          if (!seg) throw new Error(`updateSegmentsGeometry.invert: segment ${id} does not exist`)
          return { id, geometry: seg.geometry }
        }),
      ),
    merge: (next) => {
      if (next.kind !== 'updateSegmentsGeometry') return undefined
      const other = next as UpdateGeometriesCommand
      const a = updates.map((u) => u.id).sort()
      const b = other.updates.map((u) => u.id).sort()
      if (a.length !== b.length || a.some((id, i) => id !== b[i])) return undefined
      return next
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
/* Technique commands (F-021)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Replace the whole technique block. The primitive every technique edit is expressed in: its
 * inverse restores the exact previous technique, so a technique switch, a came-library edit or a
 * per-segment override change is always a single, precise undo entry (FR-4). Not exported —
 * callers use the intent-named builders below so DRC/versioning can reason about the change.
 */
function replaceTechnique(next: TechniqueSettings, kind = 'replaceTechnique'): Command {
  return {
    kind,
    apply: (doc) => ({ ...doc, technique: next }),
    invert: (before) => replaceTechnique(before.technique, kind),
  }
}

/** Switch the construction technique lead⇄foil, preserving both parameter blocks (FR-4). */
export function setTechniqueKind(kind: TechniqueKind): Command {
  return {
    kind: 'setTechniqueKind',
    apply: (doc) => replaceTechnique({ ...doc.technique, kind }).apply(doc),
    invert: (before) => replaceTechnique(before.technique),
  }
}

/** Patch the lead-came parameters (default profile, cutting tolerance). */
export function updateLeadSettings(patch: Partial<LeadSettings>): Command {
  return {
    kind: 'updateLeadSettings',
    apply: (doc) =>
      replaceTechnique({ ...doc.technique, lead: { ...doc.technique.lead, ...patch } }).apply(doc),
    invert: (before) => replaceTechnique(before.technique),
  }
}

/** Patch the copper-foil parameters (foil width, piece gap, solder finish). */
export function updateFoilSettings(patch: Partial<FoilSettings>): Command {
  return {
    kind: 'updateFoilSettings',
    apply: (doc) =>
      replaceTechnique({ ...doc.technique, foil: { ...doc.technique.foil, ...patch } }).apply(doc),
    invert: (before) => replaceTechnique(before.technique),
  }
}

/** Add a came profile to the library, or replace an existing one with the same id. */
export function upsertCameProfile(profile: CameProfile): Command {
  return {
    kind: 'upsertCameProfile',
    apply: (doc) => {
      const profiles = { ...doc.technique.lead.profiles, [profile.id]: profile }
      return replaceTechnique({
        ...doc.technique,
        lead: { ...doc.technique.lead, profiles },
      }).apply(doc)
    },
    invert: (before) => replaceTechnique(before.technique),
  }
}

/**
 * Remove a came profile from the library. Fails for the default profile (removing it would leave
 * segments with no came to resolve) — repoint the default first. Segment overrides that named the
 * removed profile fall back to the default at resolve time.
 */
export function removeCameProfile(profileId: CameProfileId): Command {
  return {
    kind: 'removeCameProfile',
    apply: (doc) => {
      const lead = doc.technique.lead
      if (profileId === lead.defaultProfileId) {
        throw new Error(`removeCameProfile: cannot remove the default profile ${profileId}`)
      }
      if (!(profileId in lead.profiles)) {
        throw new Error(`removeCameProfile: profile ${profileId} does not exist`)
      }
      const profiles = { ...lead.profiles }
      delete profiles[profileId]
      return replaceTechnique({ ...doc.technique, lead: { ...lead, profiles } }).apply(doc)
    },
    invert: (before) => replaceTechnique(before.technique),
  }
}

/**
 * Set (or clear, with `override === null`) the per-segment came override for one segment. Only the
 * two pieces adjacent to that segment change, on the shared edge only (FR-2) — the override is
 * consumed edge-locally by cut-contour computation. An empty override is stored as a clear.
 */
export function setCameOverride(segmentId: SegmentId, override: CameOverride | null): Command {
  return {
    kind: 'setCameOverride',
    apply: (doc) => {
      const overrides = { ...doc.technique.lead.overrides }
      const empty =
        !override ||
        (override.profileId === undefined &&
          override.flangeMm === undefined &&
          override.heartMm === undefined)
      if (empty) delete overrides[segmentId]
      else overrides[segmentId] = override
      return replaceTechnique({
        ...doc.technique,
        lead: { ...doc.technique.lead, overrides },
      }).apply(doc)
    },
    invert: (before) => replaceTechnique(before.technique),
  }
}

/* -------------------------------------------------------------------------- */
/* Glass commands (F-022) — project scope                                      */
/* -------------------------------------------------------------------------- */

/**
 * Add a glass to the project catalog, or replace an existing one with the same id. The glass is a
 * self-contained *copy* (consume-by-value), so the saved file renders identically on a machine with
 * an empty global library (FR-1). Reversible: its inverse restores whatever was at that id before —
 * a prior glass, or nothing.
 */
export function upsertGlass(glass: Glass): Command {
  return {
    kind: 'upsertGlass',
    apply: (doc) => ({ ...doc, glasses: { ...doc.glasses, [glass.id]: glass } }),
    invert: (before) => restoreGlass(glass.id, before.glasses[glass.id]),
  }
}

/** Remove a glass from the project catalog. Reversible — its inverse re-adds the removed glass. */
export function removeGlass(id: GlassId): Command {
  return {
    kind: 'removeGlass',
    apply: (doc) => {
      if (!(id in doc.glasses)) throw new Error(`removeGlass: glass ${id} does not exist`)
      const glasses = { ...doc.glasses }
      delete glasses[id]
      return { ...doc, glasses }
    },
    invert: (before) => restoreGlass(id, before.glasses[id]),
  }
}

/** Restore a glass id to an exact prior value (or absence) — the inverse primitive for glass edits. */
function restoreGlass(id: GlassId, prior: Glass | undefined): Command {
  return {
    kind: 'restoreGlass',
    apply: (doc) => {
      const glasses = { ...doc.glasses }
      if (prior) glasses[id] = prior
      else delete glasses[id]
      return { ...doc, glasses }
    },
    invert: (before) => restoreGlass(id, before.glasses[id]),
  }
}

/* -------------------------------------------------------------------------- */
/* Glass assignment (F-023)                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Assign (or clear) glass on one or more pieces in a single undo step (FR-1). The `patch` maps a
 * piece's content id (F-020) to a project {@link GlassId}, or to `null` to unassign it. One command
 * expresses every gesture — paint a piece, drag-paint many, bulk-assign a selection, eyedrop-then-
 * paint, unassign, and the save-time inheritance normalisation — so each is atomically reversible.
 * Self-inverting: the inverse restores exactly the prior value (a glass or absence) of every touched
 * key. Editing geometry never routes through here, so assignments only change on explicit intent.
 */
export function setGlassAssignments(patch: Readonly<Record<PieceId, GlassId | null>>): Command {
  return {
    kind: 'setGlassAssignments',
    apply: (doc) => {
      const assignments = { ...doc.assignments }
      for (const [pieceId, glassId] of Object.entries(patch)) {
        if (glassId === null) delete assignments[pieceId]
        else assignments[pieceId] = glassId
      }
      return { ...doc, assignments }
    },
    invert: (before) => {
      const inverse: Record<PieceId, GlassId | null> = {}
      for (const pieceId of Object.keys(patch)) {
        inverse[pieceId] = before.assignments[pieceId] ?? null
      }
      return setGlassAssignments(inverse)
    },
  }
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
