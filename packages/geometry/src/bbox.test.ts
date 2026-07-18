import { describe, expect, it } from 'vitest'

import {
  bboxCenter,
  bboxContainsPoint,
  bboxExpand,
  bboxHeight,
  bboxOf,
  bboxOfPoints,
  bboxOverlap,
  bboxUnion,
  bboxWidth,
} from './bbox'
import { arc, cubic, line, polygon, polyline } from './types'
import { vec2 } from './vec2'

describe('bboxOfPoints', () => {
  it('bounds a point set', () => {
    const b = bboxOfPoints([vec2(1, 2), vec2(-3, 5), vec2(0, -1)])
    expect(b.min).toEqual(vec2(-3, -1))
    expect(b.max).toEqual(vec2(1, 5))
  })

  it('throws on an empty set', () => {
    expect(() => bboxOfPoints([])).toThrow()
  })
})

describe('bboxOf primitives', () => {
  it('bounds a line, polyline and polygon by their points', () => {
    expect(bboxOf(line(vec2(0, 0), vec2(3, 4)))).toEqual({ min: vec2(0, 0), max: vec2(3, 4) })
    expect(bboxOf(polyline([vec2(0, 0), vec2(1, 5), vec2(-2, 3)]))).toEqual({
      min: vec2(-2, 0),
      max: vec2(1, 5),
    })
    expect(bboxOf(polygon([vec2(0, 0), vec2(4, 0), vec2(4, 2), vec2(0, 2)]))).toEqual({
      min: vec2(0, 0),
      max: vec2(4, 2),
    })
  })

  it('bounds a semicircular arc tightly, including the top extreme', () => {
    // Upper half of the unit circle centred at origin: y peaks at +1 mid-sweep.
    const a = arc(vec2(0, 0), 1, 0, Math.PI, true)
    const b = bboxOf(a)
    expect(b.min.x).toBeCloseTo(-1)
    expect(b.max.x).toBeCloseTo(1)
    expect(b.min.y).toBeCloseTo(0)
    expect(b.max.y).toBeCloseTo(1)
  })

  it('bounds a cubic by its true extrema, not its hull', () => {
    // Control points bulge to y=3 but the curve only reaches y=2.25.
    const c = cubic(vec2(0, 0), vec2(0, 3), vec2(1, 3), vec2(1, 0))
    const b = bboxOf(c)
    expect(b.max.y).toBeLessThan(3)
    expect(b.max.y).toBeCloseTo(2.25, 5)
  })
})

describe('bbox set operations', () => {
  const box = { min: vec2(0, 0), max: vec2(10, 4) }

  it('unions, expands and measures', () => {
    const u = bboxUnion(box, { min: vec2(-2, 1), max: vec2(3, 9) })
    expect(u).toEqual({ min: vec2(-2, 0), max: vec2(10, 9) })
    expect(bboxExpand(box, 1)).toEqual({ min: vec2(-1, -1), max: vec2(11, 5) })
    expect(bboxWidth(box)).toBe(10)
    expect(bboxHeight(box)).toBe(4)
    expect(bboxCenter(box)).toEqual(vec2(5, 2))
  })

  it('detects overlap and containment with tolerance', () => {
    expect(bboxOverlap(box, { min: vec2(5, 1), max: vec2(20, 2) })).toBe(true)
    expect(bboxOverlap(box, { min: vec2(11, 0), max: vec2(20, 4) })).toBe(false)
    expect(bboxOverlap(box, { min: vec2(11, 0), max: vec2(20, 4) }, 1)).toBe(true)
    expect(bboxContainsPoint(box, vec2(5, 2))).toBe(true)
    expect(bboxContainsPoint(box, vec2(-1, 2))).toBe(false)
    expect(bboxContainsPoint(box, vec2(-1, 2), 2)).toBe(true)
  })
})
