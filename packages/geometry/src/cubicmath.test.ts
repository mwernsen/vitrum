import { describe, expect, it } from 'vitest'

import {
  cubicAcceleration,
  cubicFlatten,
  cubicLength,
  cubicTangentAt,
  cubicVelocity,
} from './cubicmath'
import { cubic } from './types'
import { length as vlength, vec2 } from './vec2'

describe('cubic derivatives', () => {
  const c = cubic(vec2(0, 0), vec2(1, 2), vec2(3, 2), vec2(4, 0))

  it('velocity endpoints follow the control legs', () => {
    // B'(0) = 3(P1−P0), B'(1) = 3(P3−P2).
    expect(cubicVelocity(c, 0)).toEqual(vec2(3, 6))
    expect(cubicVelocity(c, 1)).toEqual(vec2(3, -6))
  })

  it('acceleration is defined across the span', () => {
    expect(vlength(cubicAcceleration(c, 0.5))).toBeGreaterThan(0)
  })

  it('falls back to a finite tangent when the first leg is degenerate', () => {
    // Coincident P0 and P1 zero the velocity at t=0; the tangent must still be unit.
    const deg = cubic(vec2(0, 0), vec2(0, 0), vec2(2, 0), vec2(4, 0))
    expect(vlength(cubicTangentAt(deg, 0))).toBeCloseTo(1)
    // Fully degenerate (all points equal) → falls back to the chord direction (zero).
    const flat = cubic(vec2(1, 1), vec2(1, 1), vec2(1, 1), vec2(1, 1))
    expect(vlength(cubicTangentAt(flat, 0))).toBe(0)
  })
})

describe('cubicLength', () => {
  it('matches the chord for a straight cubic', () => {
    expect(cubicLength(cubic(vec2(0, 0), vec2(1, 0), vec2(2, 0), vec2(3, 0)))).toBeCloseTo(3)
  })

  it('exceeds the chord for a curved one', () => {
    const c = cubic(vec2(0, 0), vec2(0, 4), vec2(4, 4), vec2(4, 0))
    expect(cubicLength(c)).toBeGreaterThan(4)
  })
})

describe('cubicFlatten', () => {
  it('starts and ends at the curve endpoints and respects tolerance', () => {
    const c = cubic(vec2(0, 0), vec2(0, 10), vec2(10, 10), vec2(10, 0))
    const pts = cubicFlatten(c, 0.1)
    expect(pts[0]).toEqual(vec2(0, 0))
    expect(pts[pts.length - 1]).toEqual(vec2(10, 0))
    expect(pts.length).toBeGreaterThan(2)
  })

  it('returns just the endpoints for an already-flat cubic', () => {
    const straight = cubic(vec2(0, 0), vec2(1, 0), vec2(2, 0), vec2(3, 0))
    expect(cubicFlatten(straight, 0.1)).toEqual([vec2(0, 0), vec2(3, 0)])
  })
})
