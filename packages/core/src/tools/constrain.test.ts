import { arc, cubic, distance, line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { constrainAngle, lineDirectionsAt, placeNumeric } from './constrain'

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

  it('locks parallel to a reference direction the 45° ladder cannot express', () => {
    // A reference line at 20°: a cursor at 22° is nearer that than the 45°/0° rays.
    const ref = vec2(Math.cos(0.349), Math.sin(0.349)) // 20°
    const to = vec2(Math.cos(0.384) * 100, Math.sin(0.384) * 100) // 22°, 100 mm out
    const out = constrainAngle(vec2(0, 0), to, [ref])
    expect(Math.atan2(out.y, out.x)).toBeCloseTo(0.349, 6)
    expect(distance(vec2(0, 0), out)).toBeCloseTo(100, 6)
  })

  it('locks perpendicular to a reference direction, and in either sense', () => {
    const ref = vec2(1, 0)
    // 88° from a horizontal reference → perpendicular (90°).
    const up = constrainAngle(vec2(0, 0), vec2(Math.cos(1.536) * 50, Math.sin(1.536) * 50), [ref])
    expect(up.x).toBeCloseTo(0, 6)
    expect(up.y).toBeCloseTo(50, 6)
    // 182° → anti-parallel.
    const back = constrainAngle(vec2(0, 0), vec2(Math.cos(3.177) * 50, Math.sin(3.177) * 50), [ref])
    expect(back.x).toBeCloseTo(-50, 6)
    expect(back.y).toBeCloseTo(0, 6)
  })

  it('keeps the absolute 45° ladder when it is the closer of the two', () => {
    const ref = vec2(Math.cos(0.349), Math.sin(0.349)) // 20°
    const out = constrainAngle(vec2(0, 0), vec2(100, 2), [ref]) // ~1° → 0°, not 20°
    expect(out.y).toBeCloseTo(0, 6)
  })

  it('ignores a degenerate reference direction', () => {
    const out = constrainAngle(vec2(0, 0), vec2(100, 8), [vec2(0, 0)])
    expect(out.y).toBeCloseTo(0, 6)
  })
})

describe('lineDirectionsAt', () => {
  const origin = vec2(0, 0)

  it('returns the direction of each line through the point', () => {
    const dirs = lineDirectionsAt(
      [line(vec2(0, 0), vec2(10, 5)), line(vec2(50, 50), vec2(60, 50))],
      origin,
      1e-6,
    )
    expect(dirs).toEqual([vec2(10, 5)])
  })

  it('counts a line the point sits on mid-span, not just at an endpoint', () => {
    const dirs = lineDirectionsAt([line(vec2(-10, 0), vec2(10, 0))], origin, 1e-6)
    expect(dirs).toEqual([vec2(20, 0)])
  })

  it('skips curves and zero-length lines — they have no single direction', () => {
    const dirs = lineDirectionsAt(
      [
        arc(vec2(0, 10), 10, 0, Math.PI, false),
        cubic(vec2(0, 0), vec2(5, 5), vec2(10, 5), vec2(10, 0)),
        line(vec2(0, 0), vec2(0, 0)),
      ],
      origin,
      1e-6,
    )
    expect(dirs).toEqual([])
  })

  it('honours the tolerance', () => {
    const nearby = [line(vec2(0, 0.5), vec2(10, 0.5))]
    expect(lineDirectionsAt(nearby, origin, 0.1)).toEqual([])
    expect(lineDirectionsAt(nearby, origin, 1)).toHaveLength(1)
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
