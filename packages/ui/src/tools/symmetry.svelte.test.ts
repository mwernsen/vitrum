import type { PreviewShape } from '@vitrum/core'
import { line, vec2 } from '@vitrum/geometry'
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
