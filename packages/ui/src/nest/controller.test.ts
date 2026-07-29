import { pieceKey, type Piece } from '@vitrum/core'
import { bboxOfPoints, vec2, type Vec2 } from '@vitrum/geometry'
import type { Glass } from '@vitrum/model'
import { afterEach, describe, expect, it } from 'vitest'

import { DocumentController } from '../document/controller.svelte'
import { createFakeHost } from '../document/fakeHost'

import {
  NestController,
  defaultRotationFor,
  sheetOptionsFor,
  FALLBACK_SHEET,
} from './controller.svelte'
import { SyncNestRunner } from './runner'

const toDispose: DocumentController[] = []
afterEach(() => {
  while (toDispose.length) toDispose.pop()!.dispose()
})

/** A minimal Piece carrying just the geometry the nester reads (ring/holeRings). */
function makePiece(id: string, ring: Vec2[]): Piece {
  return {
    id,
    boundary: [],
    holes: [],
    ring,
    holeRings: [],
    area: 0,
    perimeter: 0,
    centroid: ring[0]!,
    bbox: bboxOfPoints(ring),
  } as Piece
}

const square = (s: number): Vec2[] => [vec2(0, 0), vec2(s, 0), vec2(s, s), vec2(0, s)]

function setup(pieces: { piece: Piece; glass: string | undefined; label?: string }[]) {
  const ctrl = new DocumentController(createFakeHost())
  toDispose.push(ctrl)
  const glassByPieceId = new Map(pieces.map((p) => [p.piece.id, p.glass] as const))
  const labelByPieceId = new Map(pieces.map((p) => [p.piece.id, p.label] as const))
  const nest = new NestController({
    getDoc: () => ctrl.doc,
    execute: (c) => ctrl.execute(c),
    getPieces: () => pieces.map((p) => p.piece),
    glassFor: (p) => glassByPieceId.get(p.id),
    labelFor: (p) => labelByPieceId.get(p.id),
    runner: new SyncNestRunner(),
  })
  return { ctrl, nest }
}

describe('nesting default resolvers (F-057)', () => {
  it('constrains streaky glass to the grain (0/180°) and frees isotropic glass', () => {
    expect(defaultRotationFor({ texture: 'streaky' } as unknown as Glass)).toBe('flip')
    expect(defaultRotationFor({ texture: 'smooth' } as unknown as Glass)).toBe('quadrant')
    expect(defaultRotationFor(undefined)).toBe('quadrant')
  })

  it('offers a glass its catalog sheets, or the fallback when it has none', () => {
    const withSizes = { sheetSizes: [{ widthMm: 500, heightMm: 700 }] } as unknown as Glass
    expect(sheetOptionsFor(withSizes)).toEqual([{ widthMm: 500, heightMm: 700 }])
    expect(sheetOptionsFor(undefined)).toEqual([FALLBACK_SHEET])
  })
})

describe('NestController (F-057)', () => {
  it('nests only assigned pieces, grouped by glass, and marks the first run done', async () => {
    const { nest } = setup([
      { piece: makePiece('a', square(40)), glass: 'g1', label: 'A1' },
      { piece: makePiece('b', square(40)), glass: 'g1', label: 'A2' },
      { piece: makePiece('c', square(40)), glass: undefined }, // unassigned → skipped
    ])
    expect(nest.hasRun).toBe(false)
    expect(nest.canNest).toBe(true)
    await nest.run()
    expect(nest.hasRun).toBe(true)
    expect(nest.result?.glasses.map((g) => g.glassId)).toEqual(['g1'])
    const placed = nest.result!.glasses[0]!.sheets.flatMap((s) => s.parts)
    expect(placed.length).toBe(2)
    // Labels ride onto the layout for the printed sheet.
    expect(placed.map((p) => p.label).sort()).toEqual(['A1', 'A2'])
  })

  it('input part ids are content ids so a layout survives reload', async () => {
    const piece = makePiece('a', square(40))
    const { nest } = setup([{ piece, glass: 'g1', label: 'A1' }])
    const input = nest.buildInput()
    expect(input.parts[0]!.id).toBe(pieceKey(piece))
  })

  it('the cut allowance is a persisted, undoable edit', () => {
    const { ctrl, nest } = setup([{ piece: makePiece('a', square(40)), glass: 'g1' }])
    expect(nest.settings.spacingMm).toBe(3)
    nest.setSpacing(6)
    expect(ctrl.doc.nesting.spacingMm).toBe(6)
    ctrl.undo()
    expect(ctrl.doc.nesting.spacingMm).toBe(3)
  })

  it('reshuffle bumps the seed (reproducible layout, FR-3)', () => {
    const { ctrl, nest } = setup([{ piece: makePiece('a', square(40)), glass: 'g1' }])
    const before = nest.settings.seed
    nest.reshuffle()
    expect(ctrl.doc.nesting.seed).toBe(before + 1)
  })

  it('re-nesting with the same seed is reproducible', async () => {
    const { nest } = setup([
      { piece: makePiece('a', square(40)), glass: 'g1', label: 'A1' },
      { piece: makePiece('b', square(50)), glass: 'g1', label: 'A2' },
    ])
    await nest.run()
    const first = nest.result
    await nest.run()
    expect(nest.result).toEqual(first)
  })

  it('reports nothing to nest when no piece is assigned', () => {
    const { nest } = setup([{ piece: makePiece('a', square(40)), glass: undefined }])
    expect(nest.canNest).toBe(false)
  })
})
