import { line, pointInPolygon, polygon, vec2, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { detectPieces } from './detect'
import { pieceKey } from './assignment'
import {
  assignGlassCodes,
  codeAt,
  labelPlacement,
  renumber,
  rowMajorOrder,
  UNASSIGNED_CODE,
} from './numbering'
import type { Piece, PieceSegment } from './types'

let seq = 0
function seg(a: Vec2, b: Vec2): PieceSegment {
  const id = `s${seq++}`
  return { id, geometry: line(a, b), role: 'lead', endpoints: [`${id}a`, `${id}b`] }
}

/** Closed rectangle as four lead segments. */
function rect(x0: number, y0: number, x1: number, y1: number): PieceSegment[] {
  return [
    seg(vec2(x0, y0), vec2(x1, y0)),
    seg(vec2(x1, y0), vec2(x1, y1)),
    seg(vec2(x1, y1), vec2(x0, y1)),
    seg(vec2(x0, y1), vec2(x0, y0)),
  ]
}

/** A 2×2 grid of unit cells inside a 2×2 border → four pieces. */
function gridScene(): readonly Piece[] {
  seq = 0
  const segs: PieceSegment[] = [
    ...rect(0, 0, 2, 2),
    seg(vec2(1, 0), vec2(1, 2)), // vertical divider
    seg(vec2(0, 1), vec2(2, 1)), // horizontal divider
  ]
  return detectPieces(segs).pieces
}

describe('codeAt (F-040 glass codes)', () => {
  it('produces spreadsheet-style codes', () => {
    expect(codeAt(0)).toBe('A')
    expect(codeAt(25)).toBe('Z')
    expect(codeAt(26)).toBe('AA')
    expect(codeAt(27)).toBe('AB')
  })
})

describe('assignGlassCodes', () => {
  it('hands out A, B, C in first-appearance order', () => {
    expect(assignGlassCodes(['g1', 'g2', 'g3'], {})).toEqual({ g1: 'A', g2: 'B', g3: 'C' })
  })

  it('keeps existing codes and fills gaps with the next free letter', () => {
    // g1 already 'B'; g2 is new → gets 'A' (first free), g3 → 'C'.
    expect(assignGlassCodes(['g1', 'g2', 'g3'], { g1: 'B' })).toEqual({
      g1: 'B',
      g2: 'A',
      g3: 'C',
    })
  })
})

describe('renumber ordering (F-040 FR-1)', () => {
  it('sequential numbers pieces row-major, 1..n', () => {
    const pieces = gridScene()
    const result = renumber({
      pieces,
      scheme: 'sequential',
      glassOf: () => undefined,
      glassCodes: {},
      overrides: {},
    })
    const ordered = rowMajorOrder(pieces)
    // Top-left piece is 1, then across, then next row.
    expect(result.auto[pieceKey(ordered[0]!)]).toBe('1')
    expect(result.auto[pieceKey(ordered[1]!)]).toBe('2')
    expect(result.auto[pieceKey(ordered[2]!)]).toBe('3')
    expect(result.auto[pieceKey(ordered[3]!)]).toBe('4')
    // Every piece got exactly one number.
    expect(Object.keys(result.auto)).toHaveLength(4)
  })

  it('is deterministic regardless of input order', () => {
    const pieces = gridScene()
    const a = renumber({
      pieces,
      scheme: 'sequential',
      glassOf: () => undefined,
      glassCodes: {},
      overrides: {},
    })
    const b = renumber({
      pieces: [...pieces].reverse(),
      scheme: 'sequential',
      glassOf: () => undefined,
      glassCodes: {},
      overrides: {},
    })
    expect(a.auto).toEqual(b.auto)
  })

  it('grouped encodes the glass code and numbers within each group', () => {
    const pieces = rowMajorOrder(gridScene())
    // Two pieces glass g1, two glass g2 (interleaved by reading order).
    const glass = new Map<string, string>([
      [pieceKey(pieces[0]!), 'g1'],
      [pieceKey(pieces[1]!), 'g2'],
      [pieceKey(pieces[2]!), 'g2'],
      [pieceKey(pieces[3]!), 'g1'],
    ])
    const result = renumber({
      pieces,
      scheme: 'grouped',
      glassOf: (p) => glass.get(pieceKey(p)),
      glassCodes: {},
      overrides: {},
    })
    // g1 appears first → code A; g2 → B.
    expect(result.glassCodes).toEqual({ g1: 'A', g2: 'B' })
    expect(result.auto[pieceKey(pieces[0]!)]).toBe('A1')
    expect(result.auto[pieceKey(pieces[3]!)]).toBe('A2')
    expect(result.auto[pieceKey(pieces[1]!)]).toBe('B1')
    expect(result.auto[pieceKey(pieces[2]!)]).toBe('B2')
  })

  it('unassigned pieces group under the "?" code', () => {
    const pieces = gridScene()
    const result = renumber({
      pieces,
      scheme: 'grouped',
      glassOf: () => undefined,
      glassCodes: {},
      overrides: {},
    })
    for (const label of Object.values(result.auto)) {
      expect(label.startsWith(UNASSIGNED_CODE)).toBe(true)
    }
  })
})

describe('override persistence (F-040 FR-1)', () => {
  it('overridden pieces are skipped in the auto-sequence and keep no auto label', () => {
    const pieces = rowMajorOrder(gridScene())
    const overrideKey = pieceKey(pieces[1]!)
    const result = renumber({
      pieces,
      scheme: 'sequential',
      glassOf: () => undefined,
      glassCodes: {},
      overrides: { [overrideKey]: 'A' },
    })
    // The overridden piece is absent from auto (its manual label is authoritative).
    expect(result.auto[overrideKey]).toBeUndefined()
    // The remaining three are numbered, skipping the label 'A' is irrelevant here (numeric),
    // so 1, 2, 3 across the other pieces.
    const others = pieces
      .filter((p) => pieceKey(p) !== overrideKey)
      .map((p) => result.auto[pieceKey(p)])
    expect(new Set(others)).toEqual(new Set(['1', '2', '3']))
  })

  it('auto labels never collide with an override value', () => {
    const pieces = rowMajorOrder(gridScene())
    // Override one piece to '2' — the numeric sequence must skip '2'.
    const overrideKey = pieceKey(pieces[0]!)
    const result = renumber({
      pieces,
      scheme: 'sequential',
      glassOf: () => undefined,
      glassCodes: {},
      overrides: { [overrideKey]: '2' },
    })
    const auto = Object.values(result.auto)
    expect(auto).not.toContain('2')
    expect(auto).toHaveLength(3)
  })

  it('manual scheme emits no auto labels', () => {
    const pieces = gridScene()
    const result = renumber({
      pieces,
      scheme: 'manual',
      glassOf: () => undefined,
      glassCodes: {},
      overrides: {},
    })
    expect(result.auto).toEqual({})
  })
})

describe('labelPlacement (F-040 FR-2)', () => {
  it('places the label point inside the piece', () => {
    for (const piece of gridScene()) {
      const { at, radius } = labelPlacement(piece)
      expect(pointInPolygon(polygon(piece.ring, piece.holeRings), at)).toBe(true)
      expect(radius).toBeGreaterThan(0)
    }
  })

  it('for an L-shaped piece the point stays inside the arm, not the concave centroid', () => {
    seq = 0
    // An L: outer boundary of an L-shape (a 3×3 square with the top-right 2×2 removed).
    const lshape: PieceSegment[] = [
      seg(vec2(0, 0), vec2(3, 0)),
      seg(vec2(3, 0), vec2(3, 1)),
      seg(vec2(3, 1), vec2(1, 1)),
      seg(vec2(1, 1), vec2(1, 3)),
      seg(vec2(1, 3), vec2(0, 3)),
      seg(vec2(0, 3), vec2(0, 0)),
    ]
    const pieces = detectPieces(lshape).pieces
    expect(pieces).toHaveLength(1)
    const { at } = labelPlacement(pieces[0]!)
    expect(pointInPolygon(polygon(pieces[0]!.ring, pieces[0]!.holeRings), at)).toBe(true)
  })
})
