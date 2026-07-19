import { detectPieces, pieceKey, type PieceSegment } from '@vitrum/core'
import { line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { AssignmentController } from './assignment.svelte'

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

describe('AssignmentController (F-023)', () => {
  it('resolves a directly painted piece', () => {
    const c = new AssignmentController()
    const d = detectPieces(square())
    const key = pieceKey(d.pieces[0]!)
    c.update(d, d.pieces, d.lineage, { [key]: 'glass-1' })
    expect(c.glassFor(d.pieces[0]!)).toBe('glass-1')
  })

  it('carries inheritance across a split and survives a same-geometry re-run', () => {
    const c = new AssignmentController()
    const gen0 = detectPieces(square())
    const parentKey = pieceKey(gen0.pieces[0]!)
    const stored: Record<string, string> = { [parentKey]: 'glass-1' }
    c.update(gen0, gen0.pieces, gen0.lineage, stored)

    // Split: both fragments inherit the parent glass (new detection generation).
    const gen1 = detectPieces(splitSquare(30), { previous: gen0.pieces })
    c.update(gen1, gen1.pieces, gen1.lineage, stored)
    for (const p of gen1.pieces) expect(c.glassFor(p)).toBe('glass-1')

    // A subsequent paint of one fragment (same geometry ⇒ same generation token) must not drop the
    // other fragment's inherited glass — the inheritance base stays the pre-split generation.
    const larger = gen1.pieces.reduce((a, b) => (a.area >= b.area ? a : b))
    const smaller = gen1.pieces.reduce((a, b) => (a.area < b.area ? a : b))
    stored[pieceKey(larger)] = 'glass-2'
    c.update(gen1, gen1.pieces, gen1.lineage, stored)
    expect(c.glassFor(larger)).toBe('glass-2')
    expect(c.glassFor(smaller)).toBe('glass-1')
  })

  it('reset discards carried-forward inheritance', () => {
    const c = new AssignmentController()
    const gen0 = detectPieces(square())
    const parentKey = pieceKey(gen0.pieces[0]!)
    c.update(gen0, gen0.pieces, gen0.lineage, { [parentKey]: 'glass-1' })
    c.reset()
    expect(c.effective.size).toBe(0)

    // After reset, a split with no stored parent entry does NOT inherit (base is empty).
    const gen1 = detectPieces(splitSquare(30), { previous: gen0.pieces })
    c.update(gen1, gen1.pieces, gen1.lineage, {})
    expect(gen1.pieces.every((p) => c.glassFor(p) === undefined)).toBe(true)
  })
})
