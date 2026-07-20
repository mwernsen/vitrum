import { detectPieces, pieceKey, type PieceSegment } from '@vitrum/core'
import { line, vec2 } from '@vitrum/geometry'
import { defaultNumbering, type NumberingState } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { NumberingController } from './controller.svelte'

function square(): PieceSegment[] {
  const n = { a: vec2(0, 0), b: vec2(100, 0), c: vec2(100, 100), d: vec2(0, 100) }
  return [
    { id: 's0', geometry: line(n.a, n.b), role: 'lead', endpoints: ['a', 'b'] },
    { id: 's1', geometry: line(n.b, n.c), role: 'lead', endpoints: ['b', 'c'] },
    { id: 's2', geometry: line(n.c, n.d), role: 'lead', endpoints: ['c', 'd'] },
    { id: 's3', geometry: line(n.d, n.a), role: 'lead', endpoints: ['d', 'a'] },
  ]
}

function splitSquare(x: number): PieceSegment[] {
  return [
    ...square(),
    { id: 'div', geometry: line(vec2(x, 0), vec2(x, 100)), role: 'lead', endpoints: ['e', 'f'] },
  ]
}

function state(patch: Partial<NumberingState>): NumberingState {
  return { ...defaultNumbering(), ...patch }
}

describe('NumberingController (F-040)', () => {
  it('resolves an auto number and a manual override that wins over it', () => {
    const c = new NumberingController()
    const d = detectPieces(square())
    const key = pieceKey(d.pieces[0]!)
    c.update(d, d.pieces, d.lineage, state({ auto: { [key]: 'A1' } }))
    expect(c.labelFor(d.pieces[0]!)).toBe('A1')
    c.update(d, d.pieces, d.lineage, state({ auto: { [key]: 'A1' }, overrides: { [key]: 'star' } }))
    expect(c.labelFor(d.pieces[0]!)).toBe('star')
  })

  it('places a label point inside every piece (FR-2)', () => {
    const c = new NumberingController()
    const d = detectPieces(splitSquare(40))
    c.update(d, d.pieces, d.lineage, defaultNumbering())
    for (const piece of d.pieces) {
      const placement = c.placements.get(pieceKey(piece))
      expect(placement).toBeDefined()
      expect(placement!.radius).toBeGreaterThan(0)
    }
  })

  it('counts pieces with no number as unnumbered (FR-3)', () => {
    const c = new NumberingController()
    const d = detectPieces(splitSquare(40))
    const key = pieceKey(d.pieces[0]!)
    c.update(d, d.pieces, d.lineage, state({ auto: { [key]: '1' } }))
    expect(c.unnumberedCount(d.pieces)).toBe(1)
  })

  it('keeps a number attached across a split via inheritance (FR-3)', () => {
    const c = new NumberingController()
    const gen0 = detectPieces(square())
    const parentKey = pieceKey(gen0.pieces[0]!)
    const stored = state({ auto: { [parentKey]: 'A1' } })
    c.update(gen0, gen0.pieces, gen0.lineage, stored)
    expect(c.labelFor(gen0.pieces[0]!)).toBe('A1')

    // Split: both fragments inherit the parent's number (new generation).
    const gen1 = detectPieces(splitSquare(30), { previous: gen0.pieces })
    c.update(gen1, gen1.pieces, gen1.lineage, stored)
    for (const p of gen1.pieces) expect(c.labelFor(p)).toBe('A1')
  })

  it('reset discards carried-forward inheritance', () => {
    const c = new NumberingController()
    const gen0 = detectPieces(square())
    const parentKey = pieceKey(gen0.pieces[0]!)
    c.update(gen0, gen0.pieces, gen0.lineage, state({ auto: { [parentKey]: 'A1' } }))
    c.reset()
    expect(c.labels.size).toBe(0)

    const gen1 = detectPieces(splitSquare(30), { previous: gen0.pieces })
    c.update(gen1, gen1.pieces, gen1.lineage, defaultNumbering())
    expect(gen1.pieces.every((p) => c.labelFor(p) === undefined)).toBe(true)
  })
})
