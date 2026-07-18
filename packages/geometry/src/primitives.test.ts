import { describe, expect, it } from 'vitest'

import { ANGLE_EPS, clamp, clamp01, eq, EPS, isZero } from './epsilon'
import {
  arc,
  cubic,
  isArc,
  isCubic,
  isLine,
  isPolygon,
  isPolyline,
  line,
  polygon,
  polyline,
  type Shape,
} from './types'
import { vec2 } from './vec2'

describe('epsilon helpers', () => {
  it('compares scalars within tolerance', () => {
    expect(eq(1, 1 + EPS / 2)).toBe(true)
    expect(eq(1, 1.1)).toBe(false)
    expect(eq(1, 1.05, 0.1)).toBe(true)
    expect(isZero(ANGLE_EPS / 2)).toBe(true)
    expect(isZero(0.1)).toBe(false)
  })

  it('clamps scalars and parameters', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
    expect(clamp01(-0.2)).toBe(0)
    expect(clamp01(1.2)).toBe(1)
    expect(clamp01(0.5)).toBe(0.5)
  })
})

describe('primitive constructors and guards', () => {
  const shapes: Shape[] = [
    line(vec2(0, 0), vec2(1, 1)),
    arc(vec2(0, 0), 5, 0, 1),
    cubic(vec2(0, 0), vec2(1, 0), vec2(2, 0), vec2(3, 0)),
    polyline([vec2(0, 0), vec2(1, 0)]),
    polygon([vec2(0, 0), vec2(1, 0), vec2(0, 1)]),
  ]

  it('tags each primitive with its kind', () => {
    expect(shapes.map((s) => s.kind)).toEqual(['line', 'arc', 'cubic', 'polyline', 'polygon'])
  })

  it('arc defaults to counter-clockwise', () => {
    expect(arc(vec2(0, 0), 5, 0, 1).ccw).toBe(true)
  })

  it('polygon defaults to no holes', () => {
    expect(polygon([vec2(0, 0), vec2(1, 0), vec2(0, 1)]).holes).toEqual([])
  })

  it('each guard recognizes exactly its own kind', () => {
    const guards = [isLine, isArc, isCubic, isPolyline, isPolygon]
    guards.forEach((guard, gi) => {
      shapes.forEach((shape, si) => {
        expect(guard(shape)).toBe(gi === si)
      })
    })
  })
})
