import { describe, expect, it } from 'vitest'

import { overlapArea } from './clip'
import { vec2 } from './vec2'

const square = (x: number, y: number, s: number) => [
  vec2(x, y),
  vec2(x + s, y),
  vec2(x + s, y + s),
  vec2(x, y + s),
]

describe('overlapArea', () => {
  it('is the intersection area of two overlapping squares', () => {
    expect(overlapArea(square(0, 0, 10), square(5, 5, 10))).toBeCloseTo(25, 6)
  })

  it('is the full smaller area when one contains the other', () => {
    expect(overlapArea(square(0, 0, 10), square(2, 2, 4))).toBeCloseTo(16, 6)
  })

  it('is zero for disjoint rings (bbox short-circuit)', () => {
    expect(overlapArea(square(0, 0, 10), square(100, 100, 10))).toBe(0)
  })

  it('ignores winding — reversed rings give the same overlap', () => {
    const a = square(0, 0, 10)
    const b = square(5, 5, 10).reverse()
    expect(overlapArea(a, b)).toBeCloseTo(25, 6)
  })

  it('returns 0 for degenerate (sub-triangle) rings', () => {
    expect(overlapArea([vec2(0, 0), vec2(1, 1)], square(0, 0, 10))).toBe(0)
  })
})
