import {
  arc,
  arcEnd,
  arcStart,
  compose,
  line,
  rotation,
  scaling,
  translation,
  vec2,
  type Transform2D,
  type Vec2,
} from '@vitrum/geometry'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { weldedProjectArb } from './arbitraries'
import {
  addSegments,
  deleteNode,
  mergeNodes,
  moveNode,
  splitSegmentAtNode,
  transformSegments,
  type Command,
} from './commands'
import { weldSegments } from './factory'
import { newNodeId, newSegmentId } from './ids'
import { geometryEndpoints, incidentEndpoints } from './nodes'
import { DocumentStore } from './store'
import type { Project, Segment } from './types'

/* -------------------------------------------------------------------------- */
/* Invariant checker                                                           */
/* -------------------------------------------------------------------------- */

/** Exact coordinate equality, folding `-0` to `0` (JSON does the same). */
function sameCoord(a: Vec2, b: Vec2): boolean {
  const eq = (x: number, y: number) => x === y || (x === 0 && y === 0)
  return eq(a.x, b.x) && eq(a.y, b.y)
}

/**
 * Assert the stored-node invariants that make FR-1 structural: no dangling refs, no orphan
 * nodes, and — the junction-integrity guarantee — every endpoint welded to a node sits
 * *exactly* on that node's position. If two endpoints share a node they therefore share a
 * coordinate: an edit can never separate them.
 */
function expectNetworkIntact(project: Project): void {
  const referenced = new Set<string>()
  for (const segment of Object.values(project.segments)) {
    for (const nid of segment.endpoints) {
      referenced.add(nid)
      expect(project.nodes[nid], `node ${nid} referenced by ${segment.id} must exist`).toBeDefined()
    }
  }
  // No orphan nodes.
  expect(new Set(Object.keys(project.nodes))).toEqual(referenced)

  // Every incident endpoint coincides with its node exactly (the weld cannot drift).
  for (const [nid, node] of Object.entries(project.nodes)) {
    for (const { segment, which } of incidentEndpoints(project.segments, nid)) {
      const coord = geometryEndpoints(segment.geometry)[which]
      expect(
        sameCoord(coord, node.pos),
        `segment ${segment.id} end ${which} must sit on node ${nid}`,
      ).toBe(true)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* FR-1 property test: no edit sequence separates a shared node                */
/* -------------------------------------------------------------------------- */

type EditSpec =
  | { readonly op: 'move'; readonly node: number; readonly x: number; readonly y: number }
  | { readonly op: 'split'; readonly segment: number; readonly t: number }
  | { readonly op: 'merge'; readonly keep: number; readonly drop: number }
  | { readonly op: 'delete'; readonly node: number }
  | { readonly op: 'transform'; readonly kind: number; readonly subset: number }

const editArb: fc.Arbitrary<EditSpec> = fc.oneof(
  fc.record({
    op: fc.constant('move' as const),
    node: fc.nat(),
    x: fc.double({ min: -500, max: 500, noNaN: true, noDefaultInfinity: true }),
    y: fc.double({ min: -500, max: 500, noNaN: true, noDefaultInfinity: true }),
  }),
  fc.record({
    op: fc.constant('split' as const),
    segment: fc.nat(),
    t: fc.double({ min: 0.15, max: 0.85, noNaN: true }),
  }),
  fc.record({ op: fc.constant('merge' as const), keep: fc.nat(), drop: fc.nat() }),
  fc.record({ op: fc.constant('delete' as const), node: fc.nat() }),
  fc.record({ op: fc.constant('transform' as const), kind: fc.nat({ max: 3 }), subset: fc.nat() }),
)

function transformFor(kind: number): Transform2D {
  switch (kind % 4) {
    case 0:
      return translation(12, -7)
    case 1:
      return rotation(0.6, vec2(3, 4))
    case 2:
      return scaling(1.5, 0.5) // non-uniform → arcs demote
    default:
      return compose(translation(50, 0), scaling(-1, 1)) // mirror about x = 25
  }
}

/** Build the concrete command for an edit spec against the live document, or `null` to skip. */
function planEdit(project: Project, spec: EditSpec): Command | null {
  const nodeIds = Object.keys(project.nodes)
  const segmentIds = Object.keys(project.segments)
  if (nodeIds.length === 0 || segmentIds.length === 0) return null

  switch (spec.op) {
    case 'move':
      return moveNode(nodeIds[spec.node % nodeIds.length]!, vec2(spec.x, spec.y))
    case 'split':
      return splitSegmentAtNode(
        segmentIds[spec.segment % segmentIds.length]!,
        spec.t,
        newSegmentId(),
        newNodeId(),
      )
    case 'merge': {
      if (nodeIds.length < 2) return null
      const keep = nodeIds[spec.keep % nodeIds.length]!
      let drop = nodeIds[spec.drop % nodeIds.length]!
      if (drop === keep) drop = nodeIds[(spec.drop + 1) % nodeIds.length]!
      if (drop === keep) return null
      return mergeNodes(keep, drop)
    }
    case 'delete':
      return deleteNode(project, nodeIds[spec.node % nodeIds.length]!)
    case 'transform': {
      // Pick a non-empty subset deterministically from the low bits of `subset`.
      const chosen = segmentIds.filter((_, i) => ((spec.subset >> i) & 1) === 1)
      const subset = chosen.length > 0 ? chosen : [segmentIds[spec.subset % segmentIds.length]!]
      return transformSegments(subset, transformFor(spec.kind))
    }
  }
}

describe('FR-1: no edit sequence ever separates a welded node', () => {
  it('keeps the network intact through random move / split / merge / delete / mirror edits', () => {
    fc.assert(
      fc.property(weldedProjectArb, fc.array(editArb, { maxLength: 6 }), (project, edits) => {
        const store = new DocumentStore(project)
        expectNetworkIntact(store.document)
        for (const spec of edits) {
          const command = planEdit(store.document, spec)
          if (!command) continue
          store.execute(command)
          expectNetworkIntact(store.document)
        }
        // And every edit is exactly reversible: undo-all returns the initial document.
        while (store.canUndo) store.undo()
        expect(store.document).toEqual(project)
      }),
      { numRuns: 300 },
    )
  })
})

describe('FR-1 with arcs: demotion never separates a welded node', () => {
  it('keeps arcs-welded-to-lines intact through random node moves and mirrors', () => {
    fc.assert(
      fc.property(
        fc.record({
          cx: fc.integer({ min: -100, max: 100 }),
          cy: fc.integer({ min: -100, max: 100 }),
          r: fc.integer({ min: 10, max: 120 }),
          start: fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
          sweep: fc.double({ min: 0.3, max: Math.PI * 1.9, noNaN: true }),
          ccw: fc.boolean(),
          moveX: fc.integer({ min: -300, max: 300 }),
          moveY: fc.integer({ min: -300, max: 300 }),
          mirror: fc.boolean(),
        }),
        (p) => {
          const a = arc(
            vec2(p.cx, p.cy),
            p.r,
            p.start,
            p.start + (p.ccw ? p.sweep : -p.sweep),
            p.ccw,
          )
          const s = arcStart(a)
          const e = arcEnd(a)
          // Weld a spoke line to each arc endpoint (bit-identical coordinates → shared nodes).
          const { segments } = weldSegments([
            { geometry: a, role: 'lead' },
            { geometry: line(s, vec2(s.x + 40, s.y + 40)), role: 'lead' },
            { geometry: line(e, vec2(e.x - 40, e.y - 30)), role: 'lead' },
          ])
          const store = new DocumentStore(reconcileInitial(segments))
          const initial = store.document
          expectNetworkIntact(initial)

          // Drag the arc's start-side junction: the arc demotes but the spoke stays welded.
          store.execute(moveNode(segments[0]!.endpoints[0], vec2(p.moveX, p.moveY)))
          expectNetworkIntact(store.document)

          if (p.mirror) {
            store.execute(transformSegments(Object.keys(store.document.segments), scaling(-1, 1)))
            expectNetworkIntact(store.document)
          }

          while (store.canUndo) store.undo()
          expect(store.document).toEqual(initial)
        },
      ),
      { numRuns: 200 },
    )
  })
})

/** Seed a store document from welded segments (via one addSegments) and return the result. */
function reconcileInitial(segments: readonly Segment[]): Project {
  const store = new DocumentStore()
  store.execute(addSegments([...segments]))
  return store.document
}

/* -------------------------------------------------------------------------- */
/* Welded-drag integrity (concrete scenarios)                                  */
/* -------------------------------------------------------------------------- */

/** An L of two lines welded at (100, 0). */
function lNetwork(): { store: DocumentStore; sharedNode: string } {
  const { segments, nodes } = weldSegments([
    { geometry: line(vec2(0, 0), vec2(100, 0)), role: 'lead' },
    { geometry: line(vec2(100, 0), vec2(100, 80)), role: 'lead' },
  ])
  void nodes
  const store = new DocumentStore()
  store.execute(addSegments(segments))
  const shared = segments[0]!.endpoints[1]
  expect(shared).toBe(segments[1]!.endpoints[0])
  return { store, sharedNode: shared }
}

describe('welded-drag integrity', () => {
  it('moving a welded node drags both incident endpoints together', () => {
    const { store, sharedNode } = lNetwork()
    expect(Object.keys(store.document.nodes)).toHaveLength(3)

    store.execute(moveNode(sharedNode, vec2(140, 20)))
    expectNetworkIntact(store.document)
    const segs = Object.values(store.document.segments)
    // Both segments still meet at the moved node — still exactly 3 nodes, no tear.
    expect(Object.keys(store.document.nodes)).toHaveLength(3)
    for (const s of segs) {
      const [a, b] = geometryEndpoints(s.geometry)
      const touches = s.endpoints[0] === sharedNode ? a : s.endpoints[1] === sharedNode ? b : null
      if (touches) expect(touches).toEqual(vec2(140, 20))
    }
  })

  it('drags coalesce into a single undo step and restore the pre-drag state', () => {
    const { store, sharedNode } = lNetwork()
    const before = store.document
    store.execute(moveNode(sharedNode, vec2(110, 10)), { coalesceKey: 'drag' })
    store.execute(moveNode(sharedNode, vec2(120, 20)), { coalesceKey: 'drag' })
    store.execute(moveNode(sharedNode, vec2(140, 40)), { coalesceKey: 'drag' })
    store.undo()
    expect(store.document).toEqual(before)
  })

  it('demotes an arc to a welded cubic chain, keeping the junction and restoring on undo', () => {
    // A 180° arc → two ≤90° cubic spans; weld a line to its exact start point.
    const a = arc(vec2(0, 0), 50, 0, Math.PI, true)
    const p = arcStart(a) // (50, 0)
    const { segments } = weldSegments([
      { geometry: a, role: 'lead' },
      { geometry: line(p, vec2(120, 0)), role: 'lead' },
    ])
    const shared = segments[0]!.endpoints[0]
    expect(shared).toBe(segments[1]!.endpoints[0])
    const store = new DocumentStore()
    store.execute(addSegments(segments))
    const before = store.document
    expect(Object.keys(store.document.segments)).toHaveLength(2)
    expect(Object.keys(store.document.nodes)).toHaveLength(3)

    store.execute(moveNode(shared, vec2(60, 10)))
    expectNetworkIntact(store.document)
    // Arc → 2 cubics (original id reused for the first span, one new span + one interior node).
    const arcSeg = store.document.segments[segments[0]!.id]!
    expect(arcSeg.geometry.kind).toBe('cubic')
    expect(Object.keys(store.document.segments)).toHaveLength(3)
    expect(Object.keys(store.document.nodes)).toHaveLength(4)

    store.undo()
    expect(store.document).toEqual(before) // the arc comes back exactly
    expect(store.document.segments[segments[0]!.id]!.geometry.kind).toBe('arc')
  })

  it('splits a segment into two welded spans and reverses cleanly', () => {
    const { store } = lNetwork()
    const before = store.document
    const targetId = Object.keys(store.document.segments)[0]!
    store.execute(splitSegmentAtNode(targetId, 0.5, 'seg-new', 'node-mid'))
    expectNetworkIntact(store.document)
    expect(Object.keys(store.document.segments)).toHaveLength(3)
    expect(store.document.nodes['node-mid']!.pos).toEqual(vec2(50, 0))
    // The two halves share the mid node.
    expect(store.document.segments[targetId]!.endpoints[1]).toBe('node-mid')
    expect(store.document.segments['seg-new']!.endpoints[0]).toBe('node-mid')

    store.undo()
    expect(store.document).toEqual(before)
  })

  it('merges two separate endpoints into one node and reverses cleanly', () => {
    const s1 = line(vec2(0, 0), vec2(100, 0))
    const s2 = line(vec2(102, 1), vec2(200, 0)) // starts near, not welded
    const { segments } = weldSegments([
      { geometry: s1, role: 'lead' },
      { geometry: s2, role: 'lead' },
    ])
    const store = new DocumentStore()
    store.execute(addSegments(segments))
    const before = store.document
    expect(Object.keys(store.document.nodes)).toHaveLength(4)

    const keep = segments[0]!.endpoints[1]
    const drop = segments[1]!.endpoints[0]
    store.execute(mergeNodes(keep, drop))
    expectNetworkIntact(store.document)
    expect(Object.keys(store.document.nodes)).toHaveLength(3) // welded
    expect(store.document.segments[segments[1]!.id]!.endpoints[0]).toBe(keep)

    store.undo()
    expect(store.document).toEqual(before)
  })

  it('deletes a node with its incident spans and reverses cleanly', () => {
    const { store, sharedNode } = lNetwork()
    const before = store.document
    store.execute(deleteNode(store.document, sharedNode))
    expectNetworkIntact(store.document)
    expect(Object.keys(store.document.segments)).toHaveLength(0) // both spans touched it
    store.undo()
    expect(store.document).toEqual(before)
  })

  it('mirrors a selection without tearing welds, demoting arcs to a cubic chain', () => {
    const a = arc(vec2(50, 0), 30, 0, Math.PI, true) // 180° → two cubic spans
    const p = arcStart(a)
    const { segments } = weldSegments([
      { geometry: a, role: 'lead' },
      { geometry: line(p, vec2(200, 0)), role: 'lead' },
    ])
    const store = new DocumentStore()
    store.execute(addSegments(segments))
    const before = store.document
    const ids = Object.keys(store.document.segments)

    store.execute(transformSegments(ids, compose(scaling(-1, 1))))
    expectNetworkIntact(store.document)
    expect(store.document.segments[segments[0]!.id]!.geometry.kind).toBe('cubic')
    expect(Object.keys(store.document.segments).length).toBeGreaterThan(2) // arc demoted to a chain

    store.undo()
    expect(store.document).toEqual(before) // arc restored exactly
  })
})
