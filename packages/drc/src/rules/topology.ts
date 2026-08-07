import { pieceKey } from '@vitrum/core'
import { distance, pointAt, pointInPolygon, polygon, type Vec2 } from '@vitrum/geometry'
import type { NodeId, Project, Segment } from '@vitrum/model'

import type { RawViolation, Rule, WeldQuickFix } from '../types'

/**
 * The topology (ERC) rule pack (F-030): the network-integrity checks that formalise F-020's
 * diagnostics into severity-graded, explained violations. Three rules (dangling / near-miss /
 * duplicate) reformat the diagnostics detection already computes; three (open-border,
 * unassigned-glass, orphan-region) are derived here from the project and its pieces.
 *
 * Every rule is a pure function of {@link DrcInput}. The near-miss rule additionally resolves the
 * two welded-apart nodes so it can offer a one-click "weld it" quick-fix.
 */

function outputSegmentList(project: Project): Segment[] {
  return Object.values(project.segments).filter((s) => s.role !== 'construction')
}

function nodePos(project: Project, id: NodeId): Vec2 | undefined {
  return project.nodes[id]?.pos
}

/**
 * A rounded-position identity token (0.1 mm), matching the cuttability pack's `key`.
 *
 * The three diagnostic-derived rules need this because a diagnostic is *located*: the same segments
 * can produce several of the same kind at different places, and segment ids alone cannot tell them
 * apart. A traced cartoon (F-059) is full of fragments dangling at **both** ends, which is one
 * segment and two diagnostics — keyed on the segment alone they collapsed to a single key, so the
 * violation list carried duplicate keys and the panel that renders it threw before painting a row.
 * Waivers shared the collision too: excluding one end silently excluded the other.
 */
function posKey(p: Vec2): string {
  return `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`
}

/* -------------------------------------------------------------------------- */
/* dangling-line — a lead segment end that connects to nothing (error)         */
/* -------------------------------------------------------------------------- */

const danglingLine: Rule = {
  id: 'dangling-line',
  title: 'Dangling line',
  defaultSeverity: 'error',
  explain:
    'A lead line ends in mid-air, joined to nothing. The came has no neighbour to solder to here, ' +
    'so the join is weak and the line reads as an unfinished cut. Extend it to a joint or trim it.',
  check: (input) =>
    input.diagnostics
      .filter((d) => d.kind === 'dangling-end')
      .map((d) => ({
        at: d.at,
        message: 'segment end is not connected to the network',
        // The position distinguishes the two ends of a segment that dangles at both.
        identity: [...d.segmentIds, posKey(d.at)],
        segmentIds: [...d.segmentIds],
      })),
}

/* -------------------------------------------------------------------------- */
/* near-miss-joint — two endpoints almost, but not, welded (error) + weld fix   */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the two distinct nodes a near-miss is about, so the fix can weld them. The diagnostic
 * names the two segments and the gap's midpoint; the offending nodes are the closest endpoint pair
 * across the two segments that reference *different* nodes. Returns keep/drop deterministically
 * (smaller id kept) so redo and re-runs choose the same weld.
 */
function resolveWeld(
  project: Project,
  segmentIds: readonly string[],
): { keepNodeId: NodeId; dropNodeId: NodeId } | undefined {
  const ends: Array<{ node: NodeId; pos: Vec2 }> = []
  for (const id of segmentIds) {
    const seg = project.segments[id]
    if (!seg) continue
    for (const node of seg.endpoints) {
      const pos = nodePos(project, node)
      if (pos) ends.push({ node, pos })
    }
  }
  let best: { a: NodeId; b: NodeId; d: number } | undefined
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i]!
      const b = ends[j]!
      if (a.node === b.node) continue
      const d = distance(a.pos, b.pos)
      if (!best || d < best.d) best = { a: a.node, b: b.node, d }
    }
  }
  if (!best) return undefined
  const [keepNodeId, dropNodeId] = [best.a, best.b].sort()
  return { keepNodeId: keepNodeId!, dropNodeId: dropNodeId! }
}

const nearMissJoint: Rule = {
  id: 'near-miss-joint',
  title: 'Near-miss joint',
  defaultSeverity: 'error',
  explain:
    'Two line ends sit a hair apart but are not welded, so the panel has a gap where it looks ' +
    'joined. The came will not close here and pieces on either side are not actually separated. ' +
    'Weld the ends into one joint.',
  check: (input) =>
    input.diagnostics
      .filter((d) => d.kind === 'near-miss')
      .map((d) => {
        const weld = resolveWeld(input.project, d.segmentIds)
        const quickFix: WeldQuickFix | undefined = weld
          ? {
              kind: 'weld',
              keepNodeId: weld.keepNodeId,
              dropNodeId: weld.dropNodeId,
              label: 'Weld it',
            }
          : undefined
        const gap = d.distance !== undefined ? ` (${d.distance.toFixed(2)} mm apart)` : ''
        return {
          at: d.at,
          message: `two endpoints are not welded${gap}`,
          identity: [...d.segmentIds, posKey(d.at)],
          segmentIds: [...d.segmentIds],
          ...(d.distance !== undefined ? { distance: d.distance } : {}),
          ...(quickFix ? { quickFix } : {}),
        } satisfies RawViolation
      }),
}

/* -------------------------------------------------------------------------- */
/* duplicate-segment — two lead runs tracing the same path (warning)           */
/* -------------------------------------------------------------------------- */

const duplicateSegment: Rule = {
  id: 'duplicate-segment',
  title: 'Overlapping segments',
  defaultSeverity: 'warning',
  explain:
    'Two lead lines run over the same path. Only one came can occupy the joint, so the duplicate ' +
    'inflates the cutting list and can hide a piece that never actually closes. Delete the extra line.',
  check: (input) =>
    input.diagnostics
      .filter((d) => d.kind === 'duplicate-segment')
      .map((d) => ({
        at: d.at,
        message: 'segment overlaps another segment',
        identity: [...d.segmentIds, posKey(d.at)],
        segmentIds: [...d.segmentIds],
      })),
}

/* -------------------------------------------------------------------------- */
/* open-border — the panel border does not close (error)                       */
/* -------------------------------------------------------------------------- */

/**
 * A border made of welded segments is closed exactly when every border node is shared by two
 * border segments (degree 2). A node touched by only one border segment is a free border end —
 * the outline has a gap there. Reported at each such node.
 */
const openBorder: Rule = {
  id: 'open-border',
  title: 'Open border',
  defaultSeverity: 'error',
  explain:
    'The panel outline has a gap — the border does not form a closed loop, so there is no defined ' +
    'edge to lead and no outermost piece. Close the border so the panel has a continuous frame.',
  check: (input) => {
    const border = Object.values(input.project.segments).filter((s) => s.role === 'border')
    if (border.length === 0) return []
    const degree = new Map<NodeId, number>()
    for (const seg of border) {
      for (const node of seg.endpoints) degree.set(node, (degree.get(node) ?? 0) + 1)
    }
    const out: RawViolation[] = []
    for (const [node, deg] of degree) {
      if (deg >= 2) continue
      const pos = nodePos(input.project, node)
      if (!pos) continue
      out.push({
        at: pos,
        message: 'the border outline has a free end here',
        identity: [node],
      })
    }
    return out
  },
}

/* -------------------------------------------------------------------------- */
/* unassigned-glass — a detected piece has no glass (warning)                   */
/* -------------------------------------------------------------------------- */

const unassignedGlass: Rule = {
  id: 'unassigned-glass',
  title: 'Unassigned glass',
  defaultSeverity: 'warning',
  explain:
    'This piece has no glass assigned, so it has no colour, thickness or cost. The cutting list and ' +
    'render are incomplete until every piece names its glass. Paint it from the glass panel.',
  check: (input) => {
    const assigned = new Set(input.assignedKeys)
    return input.pieces
      .filter((piece) => !assigned.has(pieceKey(piece)))
      .map((piece) => ({
        at: piece.centroid,
        message: 'piece has no glass assigned',
        identity: [pieceKey(piece)],
        pieceIds: [piece.id],
      }))
  },
}

/* -------------------------------------------------------------------------- */
/* orphan-region — lead geometry outside the panel border (info)               */
/* -------------------------------------------------------------------------- */

/**
 * Walk the border segments into an ordered ring of node positions. Returns undefined unless the
 * border is a single closed cycle (every node degree 2) — an open border is the `open-border`
 * rule's business, and there is no "outside" to test against until it closes.
 */
function borderRing(project: Project): Vec2[] | undefined {
  const border = Object.values(project.segments).filter((s) => s.role === 'border')
  if (border.length === 0) return undefined
  const adjacency = new Map<NodeId, Segment[]>()
  for (const seg of border) {
    for (const node of seg.endpoints) {
      const list = adjacency.get(node) ?? []
      list.push(seg)
      adjacency.set(node, list)
    }
  }
  for (const list of adjacency.values()) if (list.length !== 2) return undefined

  const start = border[0]!.endpoints[0]
  const ring: Vec2[] = []
  const usedSegments = new Set<string>()
  let node: NodeId = start
  for (let i = 0; i < border.length; i++) {
    const pos = nodePos(project, node)
    if (!pos) return undefined
    ring.push(pos)
    const seg = (adjacency.get(node) ?? []).find((s) => !usedSegments.has(s.id))
    if (!seg) break
    usedSegments.add(seg.id)
    node = seg.endpoints[0] === node ? seg.endpoints[1] : seg.endpoints[0]
  }
  // A genuine closed loop consumed every border segment and returned to the start.
  if (usedSegments.size !== border.length || node !== start) return undefined
  return ring
}

const orphanRegion: Rule = {
  id: 'orphan-region',
  title: 'Orphan geometry',
  defaultSeverity: 'info',
  explain:
    'A lead line sits outside the panel border. It will not become part of any piece and is usually ' +
    'a stray line left over from editing. Move it inside the border or delete it.',
  check: (input) => {
    const ring = borderRing(input.project)
    if (!ring) return []
    const poly = polygon(ring)
    const out: RawViolation[] = []
    for (const seg of outputSegmentList(input.project)) {
      if (seg.role !== 'lead') continue
      const mid = pointAt(seg.geometry, 0.5)
      if (!pointInPolygon(poly, mid)) {
        out.push({
          at: mid,
          message: 'lead geometry lies outside the panel border',
          identity: [seg.id],
          segmentIds: [seg.id],
        })
      }
    }
    return out
  },
}

/** The topology (ERC) rule pack, in a stable display order (Scope). */
export const TOPOLOGY_RULES: readonly Rule[] = [
  openBorder,
  danglingLine,
  nearMissJoint,
  duplicateSegment,
  unassignedGlass,
  orphanRegion,
]
