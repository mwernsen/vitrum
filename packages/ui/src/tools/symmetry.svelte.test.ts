import type { PointerResolver, ResolveContext, ResolvedPoint } from '@vitrum/core'
import type { PreviewShape } from '@vitrum/core'
import { line, vec2, type Vec2 } from '@vitrum/geometry'
import { addSegment, createSegment } from '@vitrum/model'
import { afterEach, describe, expect, it } from 'vitest'

import { DocumentController } from '../document/controller.svelte'
import { createFakeHost } from '../document/fakeHost'

import { SymmetryController } from './symmetry.svelte'

/** A reactive document + a symmetry controller sharing it (mirrors the LayersPanel test helper). */
function makeSymmetry() {
  const ctrl = new DocumentController(createFakeHost())
  const controller = new SymmetryController({
    getDoc: () => ctrl.doc,
    execute: (command) => ctrl.execute(command),
    defaultCenter: () => vec2(50, 50),
  })
  toDispose.push(ctrl)
  return { ctrl, controller }
}

const toDispose: DocumentController[] = []
afterEach(() => {
  while (toDispose.length) toDispose.pop()!.dispose()
})

/** One segment preview + one anchor point (the latter must never be mirrored). */
function shapes(): PreviewShape[] {
  return [
    { kind: 'segment', geometry: line(vec2(60, 60), vec2(80, 60)), role: 'lead', ghost: true },
    { kind: 'point', at: vec2(60, 60) },
  ]
}

describe('SymmetryController — source domain (F-052 UX)', () => {
  it('is null when symmetry is off', () => {
    const { controller } = makeSymmetry()
    expect(controller.sourceDomain).toBeNull()
  })

  it('spans a half-plane for a single mirror, opening at the axis angle', () => {
    const { controller } = makeSymmetry()
    controller.setMode('mirror')
    controller.setAngleDeg(0)
    expect(controller.sourceDomain).toEqual({ start: 0, span: Math.PI })
  })

  it('spans the quadrant between the two axes for a double mirror', () => {
    const { controller } = makeSymmetry()
    controller.setMode('double-mirror')
    controller.setAngleDeg(0)
    expect(controller.sourceDomain).toEqual({ start: Math.PI / 2, span: Math.PI / 2 })
  })

  it('spans one wedge for radial, halving it when a mirror is added', () => {
    const { controller } = makeSymmetry()
    controller.setMode('radial')
    controller.setAngleDeg(0)
    controller.setCount(6)
    expect(controller.sourceDomain).toEqual({ start: 0, span: (2 * Math.PI) / 6 })
    controller.setMirror(true)
    expect(controller.sourceDomain).toEqual({ start: 0, span: Math.PI / 6 })
  })
})

describe('SymmetryController — live preview replicas (F-052 UX)', () => {
  it('returns nothing when symmetry is off', () => {
    const { controller } = makeSymmetry()
    expect(controller.previewReplicas(shapes())).toEqual([])
  })

  it('mirrors segment previews only, never the anchor point', () => {
    const { controller } = makeSymmetry()
    controller.setMode('mirror')
    controller.setAngleDeg(0) // horizontal axis through the center (50, 50)

    const replicas = controller.previewReplicas(shapes())
    // Multiplicity 2 − identity = 1 replica; the anchor point is dropped.
    expect(replicas).toHaveLength(1)
    const [only] = replicas
    if (!only || only.kind !== 'segment') throw new Error('expected a segment replica')
    expect(only.ghost).toBe(true)
    expect(only.role).toBe('lead')
    // The source endpoints at y = 60 reflect across y = 50 to y = 40.
    if (only.geometry.kind !== 'line') throw new Error('expected a line')
    expect(only.geometry.a.y).toBeCloseTo(40, 9)
    expect(only.geometry.b.y).toBeCloseTo(40, 9)
  })

  it('yields N−1 replicas for radial N, and 2N−1 with a mirror', () => {
    const { controller } = makeSymmetry()
    controller.setMode('radial')
    controller.setCount(6)
    expect(controller.previewReplicas(shapes())).toHaveLength(5)
    controller.setMirror(true)
    expect(controller.previewReplicas(shapes())).toHaveLength(11)
  })
})

/**
 * The sector resolver seam (F-052, fixing the 2026-08-16-a finding): snapping is evaluated in the
 * sector the cursor is in — so angle snap fans its rays from where the user clicked, and markers land
 * under the cursor — and only the winning point folds back into the source sector.
 *
 * All of these use mirror mode with the axis at 0° through the center (50, 50): the source half is
 * y ≥ 50, and the fold is y → 100 − y.
 */
describe('SymmetryController — sector resolver', () => {
  /** An inner resolver that records the context it was handed and answers with a fixed point. */
  function spy(answer: ResolvedPoint): { resolver: PointerResolver; seen: ResolveContext[] } {
    const seen: ResolveContext[] = []
    const resolver: PointerResolver = (world, ctx) => {
      seen.push({ ...ctx, anchors: [...ctx.anchors] })
      return answer
    }
    return { resolver, seen }
  }

  function mirrored(): ReturnType<typeof makeSymmetry> {
    const made = makeSymmetry()
    made.controller.setMode('mirror')
    made.controller.setAngleDeg(0)
    return made
  }

  it('passes a pointer in the source sector straight through', () => {
    const { controller } = mirrored()
    const world = vec2(70, 80) // y ≥ 50 ⇒ the source half
    const inner = spy({ world: vec2(72, 82) })
    const resolved = controller.sectorResolver(inner.resolver)(world, {
      toolId: 'line',
      anchors: [vec2(60, 60)],
    })
    // Untouched: the inner resolver sees the raw anchors, and the answer is not folded.
    expect(inner.seen[0]?.anchors).toEqual([vec2(60, 60)])
    expect(resolved.world).toEqual(vec2(72, 82))
  })

  it('is inert when symmetry is off', () => {
    const { controller } = makeSymmetry()
    const inner = spy({ world: vec2(72, 20) })
    const resolved = controller.sectorResolver(inner.resolver)(vec2(70, 20), {
      toolId: 'line',
      anchors: [vec2(60, 60)],
    })
    expect(resolved.world).toEqual(vec2(72, 20))
  })

  it('snaps at the cursor with the anchors mapped into its sector, then folds the winner back', () => {
    const { controller } = mirrored()
    const inner = spy({ world: vec2(72, 28) })
    const resolved = controller.sectorResolver(inner.resolver)(vec2(70, 30), {
      toolId: 'line',
      anchors: [vec2(60, 60)],
    })
    // The inner resolver measures against the anchor's image in the cursor's sector, which is where
    // the stroke the user sees starts — not against the folded anchor in the source.
    expect(inner.seen).toHaveLength(1)
    const [anchor] = inner.seen[0]!.anchors
    expect(anchor!.x).toBeCloseTo(60, 9)
    expect(anchor!.y).toBeCloseTo(40, 9)
    // Only the resolved position is folded into the source sector (FR-5).
    expect(resolved.world.x).toBeCloseTo(72, 9)
    expect(resolved.world.y).toBeCloseTo(72, 9)
  })

  it('maps an angular constraint into the sector too', () => {
    const { controller } = mirrored()
    const inner = spy({ world: vec2(72, 28) })
    controller.sectorResolver(inner.resolver)(vec2(70, 30), {
      toolId: 'line',
      anchors: [vec2(60, 60)],
      constrain: { origin: vec2(60, 60), refDirs: [vec2(0, 1)] },
    })
    const constrain = inner.seen[0]!.constrain!
    expect(constrain.origin.y).toBeCloseTo(40, 9)
    // A reflected reference direction is reflected: pointing down becomes pointing up.
    expect(constrain.refDirs[0]!.y).toBeCloseTo(-1, 9)
  })

  it('leaves the snap it reports in sector coordinates, for the overlay marker', () => {
    const { controller } = mirrored()
    const inner = spy({ world: vec2(72, 28), snap: { kind: 'grid', world: vec2(72, 28) } })
    const resolved = controller.sectorResolver(inner.resolver)(vec2(70, 30), {
      toolId: 'line',
      anchors: [],
    })
    // The marker belongs under the cursor, not in the source sector the document stores.
    expect(resolved.snap?.world).toEqual(vec2(72, 28))
  })

  it('welds an endpoint snap to the exact source anchor, not a rounding away from it', () => {
    const { controller } = mirrored()
    const anchor = vec2(60, 60)
    // The image of `anchor` in the replica sector, off by the rounding a real fold leaves behind.
    const inner = spy({
      world: vec2(60, 40 + 3e-14),
      snap: { kind: 'endpoint', world: vec2(60, 40) },
    })
    const resolved = controller.sectorResolver(inner.resolver)(vec2(60, 41), {
      toolId: 'line',
      anchors: [anchor],
    })
    // Reference-identical, so `vecKey` welds it (F-012 FR-1) instead of stacking a duplicate node.
    expect(resolved.world).toBe(anchor)
  })

  it('welds an endpoint snap to an existing document node the same way', () => {
    const { ctrl, controller } = mirrored()
    ctrl.execute(addSegment(createSegment(line(vec2(20, 60), vec2(80, 90)))))
    const pos = nodeAt(ctrl.doc.nodes, vec2(20, 60))
    const inner = spy({
      world: vec2(20, 40 - 2e-13), // the replica image of that node, plus rounding
      snap: { kind: 'endpoint', world: vec2(20, 40) },
    })
    const resolved = controller.sectorResolver(inner.resolver)(vec2(21, 41), {
      toolId: 'line',
      anchors: [],
    })
    expect(resolved.world).toBe(pos)
  })
})

/** The stored `pos` object of the node at `at`, so a test can assert reference identity. */
function nodeAt(nodes: Readonly<Record<string, { readonly pos: Vec2 }>>, at: Vec2): Vec2 {
  const found = Object.values(nodes).find((n) => n.pos.x === at.x && n.pos.y === at.y)
  if (!found) throw new Error(`no node at ${at.x},${at.y}`)
  return found.pos
}
