import { detectPieces, makeViewport, pieceKey, type PieceSegment } from '@vitrum/core'
import { line, vec2 } from '@vitrum/geometry'
import type { Command } from '@vitrum/model'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'

import type { ViewportController } from '../canvas/viewport.svelte'
import { DocumentController } from '../document/controller.svelte'
import { createFakeHost } from '../document/fakeHost'
import { AssignmentController } from '../glass/assignment.svelte'
import { PaintController } from '../tools/paint.svelte'

import Inspector from './Inspector.svelte'

/** A unit square split at x=50 → a left and right rectangle. */
function splitSquare(): PieceSegment[] {
  const n = { a: vec2(0, 0), b: vec2(100, 0), c: vec2(100, 100), d: vec2(0, 100) }
  return [
    { id: 's0', geometry: line(n.a, n.b), role: 'lead', endpoints: ['a', 'b'] },
    { id: 's1', geometry: line(n.b, n.c), role: 'lead', endpoints: ['b', 'c'] },
    { id: 's2', geometry: line(n.c, n.d), role: 'lead', endpoints: ['c', 'd'] },
    { id: 's3', geometry: line(n.d, n.a), role: 'lead', endpoints: ['d', 'a'] },
    { id: 'div', geometry: line(vec2(50, 0), vec2(50, 100)), role: 'lead', endpoints: ['e', 'f'] },
  ]
}

const toDispose: DocumentController[] = []
afterEach(() => {
  while (toDispose.length) toDispose.pop()!.dispose()
})

function setup() {
  const pieces = detectPieces(splitSquare()).pieces
  const left = pieces.find((p) => p.centroid.x < 50)!
  const ctrl = new DocumentController(createFakeHost())
  toDispose.push(ctrl)
  const viewport = { transform: makeViewport(1, vec2(0, 0)) } as unknown as ViewportController
  const paint = new PaintController({
    viewport,
    assignments: new AssignmentController(),
    getPieces: () => pieces,
    execute: (c) => ctrl.execute(c),
  })
  paint.setMode('select')
  paint.selectedPieces.add(pieceKey(left))
  return { ctrl, paint, pieces, left }
}

describe('Inspector — per-piece texture placement (F-053)', () => {
  it('hides texture controls unless the render view is active', () => {
    const { ctrl, paint, pieces } = setup()
    render(Inspector, {
      unit: 'mm',
      paint,
      pieces,
      doc: ctrl.doc,
      execute: (c) => ctrl.execute(c),
      viewMode: 'design' as const,
    })
    expect(screen.queryByLabelText('Rotation (deg)')).not.toBeInTheDocument()
  })

  it('edits rotation / offset / scale, keyed by content id, one undo entry each', async () => {
    const { ctrl, paint, pieces, left } = setup()
    // `doc` is reactive in-app (AppShell passes controller.doc); mirror that by re-rendering the
    // fresh doc between edits so each field composes onto the last (not onto a stale snapshot).
    const props = () => ({
      unit: 'mm' as const,
      paint,
      pieces,
      doc: ctrl.doc,
      execute: (c: Command) => ctrl.execute(c),
      viewMode: 'render' as const,
    })
    const view = render(Inspector, props())
    const key = pieceKey(left)

    await fireEvent.input(screen.getByLabelText('Rotation (deg)'), { target: { value: '45' } })
    expect(ctrl.doc.render.textureTransforms[key]?.rotationDeg).toBe(45)

    await view.rerender(props())
    await fireEvent.input(screen.getByLabelText('Scale'), { target: { value: '2' } })
    expect(ctrl.doc.render.textureTransforms[key]).toMatchObject({ rotationDeg: 45, scale: 2 })

    // Reset returns the piece to the identity placement (no stored entry).
    await view.rerender(props())
    await fireEvent.click(screen.getByRole('button', { name: /reset texture/i }))
    expect(ctrl.doc.render.textureTransforms[key]).toBeUndefined()

    ctrl.undo()
    expect(ctrl.doc.render.textureTransforms[key]).toMatchObject({ scale: 2 })
  })
})
