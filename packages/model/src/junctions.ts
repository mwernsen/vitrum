import { closestPoint, distance, splitAt, type Vec2 } from '@vitrum/geometry'

import { addSegments, sequence, splitSegmentAtNode, type Command } from './commands'
import { newNodeId, newSegmentId } from './ids'
import { geometryEndpoints, segmentsFromDrafts, setGeometryEndpoint, vecKey } from './nodes'
import type { Node, NodeId, Segment, SegmentGeometry, SegmentId } from './types'

/**
 * T-junction welding for committed drawing gestures (F-011/F-013).
 *
 * `segmentsFromDrafts` welds an endpoint that coincides with an existing **node**. That leaves the
 * commonest join in a real panel unwelded: a line drawn onto the *interior* of another line — the
 * border frame, or a cross-piece landing mid-span. Snapping puts such an end exactly on the curve,
 * but the target is never split, so the end stays a valence-1 node that only escapes the F-030
 * dangling-line error by being within the detector's 0.01 mm "sits on the border" grace. Anything
 * that misses by a pixel is reported as dangling, which is what a user hits in practice.
 *
 * So: an endpoint that lands on a segment's interior splits that segment there, and all three
 * spans share one node. The end is then genuinely connected, independent of any tolerance, and
 * piece detection gets a real vertex.
 */

/**
 * How close (world mm) a drawn endpoint must come to a segment's interior to count as landing on
 * it. Deliberately tight — matching `DETECT_DEFAULTS.weldTolerance`, the model's bit-exactness
 * grace — because *intent* comes from snapping (an on-curve snap lands exactly on the curve), not
 * from proximity. A loose value would silently split lines a gesture merely passed near.
 */
export const JUNCTION_TOLERANCE = 0.01

/**
 * The network a gesture is welded into: the current output segments and the node table. A narrow
 * shape rather than a whole `Project`, so the tool layer can pass what it already has.
 */
export interface NetworkLike {
  readonly segments: readonly Segment[]
  readonly nodes: Readonly<Record<NodeId, Node>>
}

/** A drawing gesture's output, before it is welded into the network. */
export interface SegmentDraftLike {
  readonly geometry: SegmentGeometry
  readonly role: Segment['role']
}

/** Where one draft endpoint landed on an existing segment, before the split chain is planned. */
interface Landing {
  readonly target: Segment
  /** Parameter along the *original* target geometry. */
  readonly t: number
  readonly draftIndex: number
  readonly which: 0 | 1
}

/** A planned split, with the ids and the exact point the split will place its node at. */
interface PlannedSplit extends Landing {
  /** `splitAt`'s own midpoint for the span actually being split, so the weld is bit-identical (I2). */
  readonly point: Vec2
  readonly nodeId: NodeId
  readonly newSegmentId: SegmentId
  readonly command: Command
}

/** The pieces a welded commit needs: the segments to add, plus the splits that receive them. */
export interface WeldedCommit {
  readonly segments: readonly Segment[]
  /** Split commands, ordered so each one's target still exists when it runs. */
  readonly splits: readonly Command[]
  /** How many T-junctions were made — for tests and for callers that want to report it. */
  readonly junctionCount: number
}

/** Segments a gesture may land on: output linework only (a construction guide is never split). */
function targets(network: NetworkLike): Segment[] {
  return network.segments.filter((s) => s.role !== 'construction')
}

/**
 * Find the segment interior an endpoint landed on, or null. Rejects a landing at (or within
 * tolerance of) the target's own endpoints — that is an endpoint weld, which node reuse already
 * handles — and prefers the nearest target when several overlap.
 */
function landingFor(
  candidates: readonly Segment[],
  at: Vec2,
  tolerance: number,
): { target: Segment; t: number } | null {
  let best: { target: Segment; t: number; d: number } | null = null
  for (const target of candidates) {
    const cp = closestPoint(target.geometry, at)
    if (cp.distance > tolerance) continue
    const [start, end] = geometryEndpoints(target.geometry)
    if (distance(cp.point, start) <= tolerance || distance(cp.point, end) <= tolerance) continue
    if (!best || cp.distance < best.d) best = { target, t: cp.t, d: cp.distance }
  }
  return best ? { target: best.target, t: best.t } : null
}

/**
 * Plan the split chain for the landings on one target segment, ascending along it. Each split runs
 * on the *tail* the previous one produced, so its parameter is rescaled to that tail (`splitAt`
 * re-parameterises each half to 0..1 for every curve kind) and its node position is taken from
 * that same split — which is what makes the weld bit-identical rather than merely equal.
 */
function planChain(target: Segment, landings: readonly Landing[]): PlannedSplit[] {
  const ordered = [...landings].sort((a, b) => a.t - b.t)
  const out: PlannedSplit[] = []
  let geometry = target.geometry
  let segmentId = target.id
  let consumed = 0 // parameter of the current span's start, on the original geometry
  for (const landing of ordered) {
    const local = (landing.t - consumed) / (1 - consumed)
    const [head, tail] = splitAt(geometry, local) as [SegmentGeometry, SegmentGeometry]
    const nodeId = newNodeId()
    const tailId = newSegmentId()
    out.push({
      ...landing,
      point: geometryEndpoints(head)[1],
      nodeId,
      newSegmentId: tailId,
      command: splitSegmentAtNode(segmentId, local, tailId, nodeId),
    })
    geometry = tail
    segmentId = tailId
    consumed = landing.t
  }
  return out
}

/**
 * Plan the welding of `drafts` into `project`: which existing segments to split, and the segments
 * to add with their landing endpoints moved onto the exact split points and sharing those nodes.
 *
 * Arc drafts are left alone at a landing end (an arc cannot keep an endpoint off its circle — see
 * `setGeometryEndpoint`), so they weld only where they already coincide with a node.
 */
export function planWeldedCommit(
  network: NetworkLike,
  drafts: readonly SegmentDraftLike[],
  tolerance = JUNCTION_TOLERANCE,
): WeldedCommit {
  const candidates = targets(network)
  const landings: Landing[] = []

  drafts.forEach((draft, draftIndex) => {
    if (draft.geometry.kind === 'arc') return
    const ends = geometryEndpoints(draft.geometry)
    for (const which of [0, 1] as const) {
      const found = landingFor(candidates, ends[which], tolerance)
      if (found) landings.push({ target: found.target, t: found.t, draftIndex, which })
    }
  })

  if (landings.length === 0) {
    return { segments: segmentsFromDrafts(drafts, network.nodes), splits: [], junctionCount: 0 }
  }

  const byTarget = new Map<SegmentId, Landing[]>()
  for (const landing of landings) {
    const list = byTarget.get(landing.target.id)
    if (list) list.push(landing)
    else byTarget.set(landing.target.id, [landing])
  }
  const planned = [...byTarget].flatMap(([, group]) => planChain(group[0]!.target, group))

  // Move each landing endpoint onto its exact split point, so the node the split creates and the
  // endpoint that reuses it are bit-identical (invariant I2).
  const adjusted = drafts.map((draft) => ({ ...draft }))
  const pinned = new Map<string, NodeId>()
  for (const split of planned) {
    const draft = adjusted[split.draftIndex]!
    adjusted[split.draftIndex] = {
      ...draft,
      geometry: setGeometryEndpoint(draft.geometry, split.which, split.point),
    }
    pinned.set(vecKey(split.point), split.nodeId)
  }

  return {
    segments: segmentsFromDrafts(adjusted, network.nodes, pinned),
    splits: planned.map((s) => s.command),
    junctionCount: planned.length,
  }
}

/**
 * One command for a committed gesture: split every segment its endpoints landed on, then add the
 * gesture's segments welded into those junctions. One undo entry for the whole gesture (FR-1).
 */
export function addSegmentsWelded(
  network: NetworkLike,
  drafts: readonly SegmentDraftLike[],
  tolerance = JUNCTION_TOLERANCE,
): Command {
  const plan = planWeldedCommit(network, drafts, tolerance)
  if (plan.splits.length === 0) return addSegments(plan.segments)
  return sequence([...plan.splits, addSegments(plan.segments)])
}
