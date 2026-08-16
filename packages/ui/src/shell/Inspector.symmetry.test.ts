import { detectPieces, makeViewport, pieceKey, type PieceSegment } from '@vitrum/core'
import { line, vec2 } from '@vitrum/geometry'
import { render, screen } from '@testing-library/svelte'
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

/** Select one piece, with the right-hand rectangle standing in as a live replica of the left. */
function setup(select: 'source' | 'replica') {
  const detection = detectPieces(splitSquare())
  const pieces = detection.pieces
  const left = pieces.find((p) => p.centroid.x < 50)!
  const right = pieces.find((p) => p.centroid.x > 50)!
  const ctrl = new DocumentController(createFakeHost())
  toDispose.push(ctrl)
  const assignments = new AssignmentController()
  assignments.update(
    { ...detection, symLineage: { [pieceKey(right)]: pieceKey(left) } },
    pieces,
    detection.lineage,
    {},
  )
  const viewport = { transform: makeViewport(1, vec2(0, 0)) } as unknown as ViewportController
  const paint = new PaintController({
    viewport,
    assignments,
    getPieces: () => pieces,
    execute: (c) => ctrl.execute(c),
  })
  paint.setMode('select')
  paint.selectedPieces.add(pieceKey(select === 'source' ? left : right))
  return { ctrl, paint, pieces, assignments }
}

describe('Inspector — a replica piece explains its glass (F-052)', () => {
  const note = /glass follows the source sector/i

  it('says so when the selected piece is a live symmetry replica', () => {
    const { ctrl, paint, pieces, assignments } = setup('replica')
    render(Inspector, {
      unit: 'mm',
      paint,
      pieces,
      assignments,
      doc: ctrl.doc,
      viewMode: 'design' as const,
    })
    expect(screen.getByText(note)).toBeInTheDocument()
  })

  it('stays quiet for a source piece', () => {
    const { ctrl, paint, pieces, assignments } = setup('source')
    render(Inspector, {
      unit: 'mm',
      paint,
      pieces,
      assignments,
      doc: ctrl.doc,
      viewMode: 'design' as const,
    })
    expect(screen.queryByText(note)).not.toBeInTheDocument()
  })
})
