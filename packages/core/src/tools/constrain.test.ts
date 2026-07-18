import { distance, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { constrainAngle, placeNumeric } from './constrain'

describe('constrainAngle', () => {
  it('snaps a near-horizontal direction onto 0° and keeps the distance', () => {
    const out = constrainAngle(vec2(0, 0), vec2(100, 8))
    expect(out.y).toBeCloseTo(0, 6)
    expect(out.x).toBeCloseTo(Math.hypot(100, 8), 6)
  })

  it('snaps a near-diagonal direction onto 45°', () => {
    const out = constrainAngle(vec2(0, 0), vec2(100, 90))
    expect(out.x).toBeCloseTo(out.y, 6)
  })

  it('snaps a near-vertical direction onto 90°', () => {
    const out = constrainAngle(vec2(10, 10), vec2(14, 110))
    expect(out.x).toBeCloseTo(10, 6)
  })

  it('returns the point unchanged when it coincides with the origin', () => {
    const p = vec2(5, 5)
    expect(constrainAngle(p, p)).toEqual(p)
  })
})

describe('placeNumeric', () => {
  it('places a point an explicit length along the cursor direction', () => {
    const out = placeNumeric(vec2(0, 0), { length: 100 }, vec2(3, 4))
    // Direction (3,4) is a 3-4-5 triangle, so 100 mm lands at (60, 80).
    expect(out.x).toBeCloseTo(60, 6)
    expect(out.y).toBeCloseTo(80, 6)
    expect(distance(vec2(0, 0), out)).toBeCloseTo(100, 6)
  })

  it('honours an explicit angle over the cursor', () => {
    const out = placeNumeric(vec2(0, 0), { length: 10, angle: 0 }, vec2(0, 999))
    expect(out).toEqual(vec2(10, 0))
  })

  it('constrains the direction to 45° under shift', () => {
    const out = placeNumeric(vec2(0, 0), { length: Math.SQRT2 }, vec2(10, 9), true)
    expect(out.x).toBeCloseTo(1, 6)
    expect(out.y).toBeCloseTo(1, 6)
  })

  it('falls back to +x with no angle and no cursor', () => {
    expect(placeNumeric(vec2(2, 2), { length: 5 }, null)).toEqual(vec2(7, 2))
  })
})
