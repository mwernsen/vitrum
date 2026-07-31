import { cubic, line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { addSegments } from './commands'
import { weldSegments } from './factory'
import { addSegmentsWelded, planWeldedCommit } from './junctions'
import { referencedNodeIds } from './nodes'
import { DocumentStore } from './store'
import type { Project, Segment } from './types'

/** A store holding a 100 × 100 border frame, plus a helper to read the live network. */
function setup(extra: { geometry: Segment['geometry']; role: Segment['role'] }[] = []) {
  const { segments } = weldSegments([
    { geometry: line(vec2(0, 0), vec2(100, 0)), role: 'border' },
    { geometry: line(vec2(100, 0), vec2(100, 100)), role: 'border' },
    { geometry: line(vec2(100, 100), vec2(0, 100)), role: 'border' },
    { geometry: line(vec2(0, 100), vec2(0, 0)), role: 'border' },
    ...extra,
  ])
  const store = new DocumentStore()
  store.execute(addSegments(segments))
  return { store, network: () => net(store.document) }
}

const net = (doc: Project) => ({ segments: Object.values(doc.segments), nodes: doc.nodes })

/** How many segments reference `nodeId` — the valence the dangling-line check reads. */
function valence(doc: Project, at: { x: number; y: number }): number {
  const nodeId = Object.entries(doc.nodes).find(
    ([, n]) => n.pos.x === at.x && n.pos.y === at.y,
  )?.[0]
  if (!nodeId) return 0
  return Object.values(doc.segments).filter((s) => s.endpoints.includes(nodeId)).length
}

/** Every invariant the node model promises: no dangling refs, no orphans, endpoints bit-exact. */
function assertInvariants(doc: Project): void {
  const referenced = referencedNodeIds(doc.segments)
  expect(new Set(Object.keys(doc.nodes))).toEqual(referenced)
  for (const seg of Object.values(doc.segments)) {
    const g = seg.geometry
    if (g.kind !== 'line') continue
    expect(doc.nodes[seg.endpoints[0]]!.pos).toEqual(g.a)
    expect(doc.nodes[seg.endpoints[1]]!.pos).toEqual(g.b)
  }
}

describe('addSegmentsWelded — T-junctions', () => {
  it('an end landing on a border span splits it, so the end is connected, not dangling', () => {
    const { store, network } = setup()
    // A line from inside the panel up onto the top border at x = 40.
    store.execute(
      addSegmentsWelded(network(), [{ geometry: line(vec2(40, 50), vec2(40, 0)), role: 'lead' }]),
    )
    const doc = store.document

    // The top border became two spans; the frame is now five segments plus the drawn line.
    expect(Object.values(doc.segments).filter((s) => s.role === 'border')).toHaveLength(5)
    // Three spans meet at the junction: the two border halves and the new line.
    expect(valence(doc, vec2(40, 0))).toBe(3)
    assertInvariants(doc)
  })

  it('is one undo entry that restores the frame exactly', () => {
    const { store, network } = setup()
    const before = JSON.stringify(store.document)
    store.execute(
      addSegmentsWelded(network(), [{ geometry: line(vec2(40, 50), vec2(40, 0)), role: 'lead' }]),
    )
    expect(store.canUndo).toBe(true)
    store.undo()
    expect(JSON.stringify(store.document)).toBe(before)
    // And redo puts the junction back, with the same ids (the plan is minted once).
    store.redo()
    expect(valence(store.document, vec2(40, 0))).toBe(3)
    assertInvariants(store.document)
  })

  it('welds both ends of a span that crosses the panel onto two different borders', () => {
    const { store, network } = setup()
    store.execute(
      addSegmentsWelded(network(), [{ geometry: line(vec2(0, 30), vec2(100, 70)), role: 'lead' }]),
    )
    const doc = store.document
    expect(valence(doc, vec2(0, 30))).toBe(3)
    expect(valence(doc, vec2(100, 70))).toBe(3)
    expect(Object.values(doc.segments).filter((s) => s.role === 'border')).toHaveLength(6)
    assertInvariants(doc)
  })

  it('splits one border span twice when two ends land on it', () => {
    const { store, network } = setup()
    store.execute(
      addSegmentsWelded(network(), [
        { geometry: line(vec2(25, 0), vec2(50, 40)), role: 'lead' },
        { geometry: line(vec2(50, 40), vec2(75, 0)), role: 'lead' },
      ]),
    )
    const doc = store.document
    expect(valence(doc, vec2(25, 0))).toBe(3)
    expect(valence(doc, vec2(75, 0))).toBe(3)
    // The top span became three: 0..25, 25..75, 75..100.
    expect(Object.values(doc.segments).filter((s) => s.role === 'border')).toHaveLength(6)
    assertInvariants(doc)
  })

  it('a polyline chain welds its junction ends and keeps its own shared nodes', () => {
    const { store, network } = setup()
    store.execute(
      addSegmentsWelded(network(), [
        { geometry: line(vec2(20, 0), vec2(50, 50)), role: 'lead' },
        { geometry: line(vec2(50, 50), vec2(100, 60)), role: 'lead' },
      ]),
    )
    const doc = store.document
    expect(valence(doc, vec2(20, 0))).toBe(3) // onto the top border
    expect(valence(doc, vec2(50, 50))).toBe(2) // the chain's own corner
    expect(valence(doc, vec2(100, 60))).toBe(3) // onto the right border
    assertInvariants(doc)
  })

  it('a cubic end landing on a line welds too (its handles are left alone)', () => {
    const { store, network } = setup()
    store.execute(
      addSegmentsWelded(network(), [
        { geometry: cubic(vec2(50, 50), vec2(60, 40), vec2(70, 20), vec2(60, 0)), role: 'lead' },
      ]),
    )
    expect(valence(store.document, vec2(60, 0))).toBe(3)
  })
})

describe('addSegmentsWelded — when it must not split', () => {
  it('leaves an end that merely lands near a line alone (intent comes from snapping)', () => {
    const { store, network } = setup()
    // 0.2 mm short of the border — well outside the junction tolerance.
    store.execute(
      addSegmentsWelded(network(), [{ geometry: line(vec2(40, 50), vec2(40, 0.2)), role: 'lead' }]),
    )
    const doc = store.document
    expect(Object.values(doc.segments).filter((s) => s.role === 'border')).toHaveLength(4)
    expect(valence(doc, vec2(40, 0.2))).toBe(1)
  })

  it('an end at a border corner reuses that node instead of splitting', () => {
    const { store, network } = setup()
    store.execute(
      addSegmentsWelded(network(), [{ geometry: line(vec2(50, 50), vec2(0, 0)), role: 'lead' }]),
    )
    const doc = store.document
    expect(Object.values(doc.segments).filter((s) => s.role === 'border')).toHaveLength(4)
    expect(valence(doc, vec2(0, 0))).toBe(3) // two border spans + the new line
    assertInvariants(doc)
  })

  it('never splits a construction guide', () => {
    const { store, network } = setup([
      { geometry: line(vec2(-500, 50), vec2(500, 50)), role: 'construction' },
    ])
    const plan = planWeldedCommit(network(), [
      { geometry: line(vec2(30, 20), vec2(30, 50)), role: 'lead' },
    ])
    expect(plan.junctionCount).toBe(0)
    void store
  })

  it('a gesture touching nothing produces a plain add', () => {
    const { network } = setup()
    const plan = planWeldedCommit(network(), [
      { geometry: line(vec2(30, 30), vec2(60, 60)), role: 'lead' },
    ])
    expect(plan.junctionCount).toBe(0)
    expect(plan.splits).toHaveLength(0)
  })
})
