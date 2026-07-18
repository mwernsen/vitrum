import { describe, expect, it } from 'vitest'

import {
  area,
  centroid,
  ensureWinding,
  isCCW,
  normalizePolygon,
  pointInPolygon,
  pointInRing,
  signedArea,
} from './polygon'
import { polygon } from './types'
import { vec2 } from './vec2'

const square = [vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)] // CCW
const squareCW = [...square].reverse()

describe('winding and signed area', () => {
  it('is positive for CCW and negative for CW rings', () => {
    expect(signedArea(square)).toBeCloseTo(100)
    expect(signedArea(squareCW)).toBeCloseTo(-100)
    expect(isCCW(square)).toBe(true)
    expect(isCCW(squareCW)).toBe(false)
  })

  it('ensureWinding flips only when needed', () => {
    expect(ensureWinding(square, true)).toBe(square) // already CCW → same reference
    expect(isCCW(ensureWinding(squareCW, true))).toBe(true)
    expect(isCCW(ensureWinding(square, false))).toBe(false)
  })
})

describe('area and centroid', () => {
  it('nets holes out of the outer area', () => {
    const withHole = polygon(square, [[vec2(2, 2), vec2(4, 2), vec2(4, 4), vec2(2, 4)]])
    expect(area(withHole)).toBeCloseTo(100 - 4)
  })

  it('is winding-agnostic', () => {
    expect(area(polygon(squareCW))).toBeCloseTo(100)
  })

  it('centres a symmetric square at its middle', () => {
    expect(centroid(polygon(square))).toEqual(vec2(5, 5))
  })

  it('shifts the centroid away from a hole', () => {
    const withHole = polygon(square, [[vec2(6, 6), vec2(8, 6), vec2(8, 8), vec2(6, 8)]])
    const c = centroid(withHole)
    // Hole in the upper-right pulls the centroid toward the lower-left.
    expect(c.x).toBeLessThan(5)
    expect(c.y).toBeLessThan(5)
  })

  it('falls back to the vertex average for a degenerate polygon', () => {
    const line = polygon([vec2(0, 0), vec2(4, 0), vec2(2, 0)])
    expect(centroid(line)).toEqual(vec2(2, 0))
  })
})

describe('point in polygon', () => {
  it('classifies interior, exterior and boundary points of a ring', () => {
    expect(pointInRing(square, vec2(5, 5))).toBe(true)
    expect(pointInRing(square, vec2(15, 5))).toBe(false)
    expect(pointInRing(square, vec2(0, 5))).toBe(true) // on an edge
    expect(pointInRing(square, vec2(10, 10))).toBe(true) // on a vertex
  })

  it('treats holes as outside but their boundary as inside', () => {
    const withHole = polygon(square, [[vec2(3, 3), vec2(7, 3), vec2(7, 7), vec2(3, 7)]])
    expect(pointInPolygon(withHole, vec2(5, 5))).toBe(false) // inside the hole
    expect(pointInPolygon(withHole, vec2(1, 1))).toBe(true) // in the material
    expect(pointInPolygon(withHole, vec2(3, 5))).toBe(true) // on the hole boundary
    expect(pointInPolygon(withHole, vec2(20, 20))).toBe(false) // outside entirely
  })
})

describe('normalizePolygon', () => {
  it('makes the outer ring CCW and holes CW', () => {
    const messy = polygon(squareCW, [[vec2(3, 3), vec2(3, 7), vec2(7, 7), vec2(7, 3)]])
    const norm = normalizePolygon(messy)
    expect(isCCW(norm.outer)).toBe(true)
    expect(isCCW(norm.holes[0]!)).toBe(false)
  })
})
