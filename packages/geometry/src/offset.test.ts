import { describe, expect, it } from 'vitest'

import {
  area,
  curveLength,
  flattenCurve,
  offsetArc,
  offsetCubic,
  offsetLine,
  signedArea,
} from './index'
import { offsetPolygon, offsetPolyline } from './offset'
import { pointInPolygon } from './polygon'
import { arc, cubic, line, polygon, polyline } from './types'
import { distance, vec2 } from './vec2'

describe('offsetLine', () => {
  it('shifts a segment to the left of its direction by d', () => {
    // Rightward segment offset by +2 moves up (left side) to y=2.
    const o = offsetLine(line(vec2(0, 0), vec2(10, 0)), 2)
    expect(o.a).toEqual(vec2(0, 2))
    expect(o.b).toEqual(vec2(10, 2))
  })
})

describe('offsetArc', () => {
  it('shrinks a CCW arc and grows a CW arc', () => {
    expect(offsetArc(arc(vec2(0, 0), 5, 0, 1, true), 2)!.radius).toBeCloseTo(3)
    expect(offsetArc(arc(vec2(0, 0), 5, 0, 1, false), 2)!.radius).toBeCloseTo(7)
  })

  it('returns null when the radius collapses through the centre', () => {
    expect(offsetArc(arc(vec2(0, 0), 5, 0, 1, true), 6)).toBeNull()
  })
})

describe('offsetCubic', () => {
  it('offsets a straight cubic to a parallel curve at distance d', () => {
    const straight = cubic(vec2(0, 0), vec2(3, 0), vec2(6, 0), vec2(9, 0))
    const pieces = offsetCubic(straight, 2)
    expect(pieces.length).toBeGreaterThanOrEqual(1)
    // Every sampled point of the offset sits ~2mm to the left (up) of the x-axis.
    for (const piece of pieces) {
      for (const p of flattenCurve(piece, 0.1)) expect(p.y).toBeCloseTo(2, 6)
    }
  })
})

describe('offsetPolyline', () => {
  it('offsets an open path and reports no self-intersection for a gentle bend', () => {
    const pl = polyline([vec2(0, 0), vec2(10, 0), vec2(10, 10)])
    const res = offsetPolyline(pl, 1)
    expect(res.selfIntersects).toBe(false)
    expect(res.contour.points.length).toBeGreaterThanOrEqual(3)
  })

  it('bevels a sharp hairpin instead of shooting the miter to infinity', () => {
    // A near-180° reversal: the miter would run off far, so the join bevels (two points).
    const hairpin = polyline([vec2(0, 0), vec2(10, 0), vec2(0, 0.5)])
    const res = offsetPolyline(hairpin, 1, 2)
    expect(res.contour.points.length).toBeGreaterThan(3) // bevel added an extra vertex
  })

  it('passes a collinear middle vertex straight through', () => {
    const straight = polyline([vec2(0, 0), vec2(5, 0), vec2(10, 0)])
    const res = offsetPolyline(straight, 2)
    for (const p of res.contour.points) expect(p.y).toBeCloseTo(2)
  })
})

describe('offsetPolygon (FR-3)', () => {
  const square = polygon([vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)])

  it('growing outward returns a closed contour with the expected larger area', () => {
    const res = offsetPolygon(square, 2)
    expect(res.selfIntersects).toBe(false)
    // A 10×10 square grown by 2 on every side becomes 14×14.
    expect(area(res.contour)).toBeCloseTo(14 * 14)
    // Original corners remain inside the grown contour.
    expect(pointInPolygon(res.contour, vec2(0, 0))).toBe(true)
  })

  it('insetting shrinks the region', () => {
    const res = offsetPolygon(square, -2)
    expect(res.selfIntersects).toBe(false)
    expect(area(res.contour)).toBeCloseTo(6 * 6)
  })

  it('flags a self-intersecting result when inset past the feature size', () => {
    // A thin triangle inset by more than its inradius folds over itself.
    const thin = polygon([vec2(0, 0), vec2(20, 0), vec2(10, 3)])
    const res = offsetPolygon(thin, -5)
    expect(res.selfIntersects).toBe(true)
  })

  it('shrinks a hole when the region grows', () => {
    const withHole = polygon(
      [vec2(0, 0), vec2(20, 0), vec2(20, 20), vec2(0, 20)],
      [[vec2(7, 7), vec2(13, 7), vec2(13, 13), vec2(7, 13)]], // 6×6 hole (half-width 3)
    )
    // Growing the region by 1 shrinks the hole to 4×4.
    const res = offsetPolygon(withHole, 1)
    expect(res.contour.holes.length).toBe(1)
    expect(Math.abs(signedArea(res.contour.holes[0]!))).toBeCloseTo(16)
  })

  it('preserves the offset distance around the boundary', () => {
    const res = offsetPolygon(square, 3)
    // The grown square should be 16×16 → perimeter 64.
    let perimeter = 0
    const pts = res.contour.outer
    for (let i = 0; i < pts.length; i++) {
      perimeter += distance(pts[i]!, pts[(i + 1) % pts.length]!)
    }
    expect(perimeter).toBeCloseTo(64)
  })
})

describe('offset closed-contour length sanity', () => {
  it('a circle-like polygon grows in perimeter when offset outward', () => {
    const octagon = polygon(
      Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2
        return vec2(Math.cos(a) * 10, Math.sin(a) * 10)
      }),
    )
    const grown = offsetPolygon(octagon, 2)
    const before = curveLength(polyline([...octagon.outer, octagon.outer[0]!]))
    const after = curveLength(polyline([...grown.contour.outer, grown.contour.outer[0]!]))
    expect(after).toBeGreaterThan(before)
  })
})
