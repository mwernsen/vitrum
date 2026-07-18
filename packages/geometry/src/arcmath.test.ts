import { describe, expect, it } from 'vitest'

import { arcEnd, arcPointAt, arcStart, arcSweep, arcToCubics } from './arcmath'
import { curveLength } from './index'
import { arc } from './types'
import { distance, length as vlength, vec2 } from './vec2'

describe('arcSweep', () => {
  it('measures a quarter turn regardless of direction', () => {
    expect(arcSweep(arc(vec2(0, 0), 5, 0, Math.PI / 2, true))).toBeCloseTo(Math.PI / 2)
    expect(arcSweep(arc(vec2(0, 0), 5, Math.PI / 2, 0, false))).toBeCloseTo(Math.PI / 2)
  })

  it('treats a full turn as 2π rather than collapsing to zero', () => {
    // start == end but a full circle intended (raw = 2π) → sweep 2π, not 0.
    expect(arcSweep(arc(vec2(0, 0), 5, 0, Math.PI * 2, true))).toBeCloseTo(Math.PI * 2)
  })

  it('wraps a sweep that crosses the +x axis', () => {
    // From 315° CCW to 45° is a 90° sweep across angle 0.
    const a = arc(vec2(0, 0), 5, (7 * Math.PI) / 4, Math.PI / 4, true)
    expect(arcSweep(a)).toBeCloseTo(Math.PI / 2)
  })
})

describe('arc endpoints', () => {
  it('reports start and end points on the circle', () => {
    const a = arc(vec2(1, 1), 2, 0, Math.PI, true)
    expect(distance(arcStart(a), vec2(3, 1))).toBeLessThan(1e-9)
    expect(distance(arcEnd(a), vec2(-1, 1))).toBeLessThan(1e-9)
  })
})

describe('arcToCubics', () => {
  it('splits a >90° sweep into multiple ≤90° cubic pieces', () => {
    const semi = arc(vec2(0, 0), 10, 0, Math.PI, true) // 180° → 2 pieces
    const pieces = arcToCubics(semi)
    expect(pieces.length).toBe(2)
    // Endpoints of the chain match the arc's endpoints.
    expect(distance(pieces[0]!.p0, arcStart(semi))).toBeLessThan(1e-9)
    expect(distance(pieces[pieces.length - 1]!.p3, arcEnd(semi))).toBeLessThan(1e-9)
  })

  it('approximates a full circle whose cubic samples stay on the radius', () => {
    const circle = arc(vec2(0, 0), 8, 0, Math.PI * 2, true)
    const pieces = arcToCubics(circle)
    expect(pieces.length).toBe(4) // four quadrants
    for (const piece of pieces) {
      expect(Math.abs(vlength(piece.p0) - 8)).toBeLessThan(1e-6)
    }
  })

  it('traces a CW arc in the reverse angular direction', () => {
    const cw = arc(vec2(0, 0), 5, Math.PI / 2, 0, false)
    const pieces = arcToCubics(cw)
    expect(distance(pieces[0]!.p0, arcPointAt(cw, 0))).toBeLessThan(1e-9)
  })

  it('a cubic chain has roughly the arc length of the true arc', () => {
    const a = arc(vec2(0, 0), 12, 0, Math.PI / 2, true)
    const chainLen = arcToCubics(a).reduce((sum, c) => sum + curveLength(c), 0)
    expect(chainLen).toBeCloseTo(curveLength(a), 1)
  })
})
