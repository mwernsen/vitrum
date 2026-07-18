import { describe, expect, it } from 'vitest'

import { pieceArea, piecePerimeter, totalLeadLength, type GlassPiece, type Panel } from './index'

function piece(vertices: GlassPiece['vertices']): GlassPiece {
  return { id: 'p1', label: 'Test piece', color: '#1d4ed8', vertices }
}

const unitSquare = piece([
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
])

const triangle = piece([
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 0, y: 40 },
])

describe('pieceArea', () => {
  it('computes the area of a square', () => {
    expect(pieceArea(unitSquare)).toBe(100)
  })

  it('computes the area of a right triangle', () => {
    expect(pieceArea(triangle)).toBe(600)
  })

  it('is independent of winding order', () => {
    const reversed = piece([...unitSquare.vertices].reverse())
    expect(pieceArea(reversed)).toBe(pieceArea(unitSquare))
  })

  it('rejects degenerate polygons', () => {
    expect(() =>
      pieceArea(
        piece([
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]),
      ),
    ).toThrow(/at least 3 vertices/)
  })
})

describe('piecePerimeter', () => {
  it('computes the perimeter of a square', () => {
    expect(piecePerimeter(unitSquare)).toBe(40)
  })

  it('computes the perimeter of a 3-4-5 right triangle', () => {
    expect(piecePerimeter(triangle)).toBe(120)
  })
})

describe('totalLeadLength', () => {
  it('sums perimeters across all pieces in a panel', () => {
    const panel: Panel = {
      id: 'panel-1',
      name: 'Sample',
      widthMm: 300,
      heightMm: 400,
      pieces: [unitSquare, triangle],
    }
    expect(totalLeadLength(panel)).toBe(160)
  })

  it('is zero for an empty panel', () => {
    const panel: Panel = { id: 'panel-1', name: 'Empty', widthMm: 300, heightMm: 400, pieces: [] }
    expect(totalLeadLength(panel)).toBe(0)
  })
})
