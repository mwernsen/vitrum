import { describe, expect, it } from 'vitest'

import { arcPointAt } from './arcmath'
import {
  closestPoint,
  curveLength,
  curvatureAt,
  flattenCurve,
  pointAt,
  splitAt,
  tangentAt,
} from './index'
import { makeRng } from './rand'
import type { Curve } from './types'
import { arc, cubic, line, polyline } from './types'
import { distance, length as vlength, vec2 } from './vec2'

const samples: Curve[] = [
  line(vec2(0, 0), vec2(3, 4)),
  arc(vec2(0, 0), 5, 0, Math.PI / 2, true),
  arc(vec2(1, 1), 2, Math.PI, 0, false),
  cubic(vec2(0, 0), vec2(1, 2), vec2(3, 2), vec2(4, 0)),
  polyline([vec2(0, 0), vec2(3, 0), vec2(3, 4)]),
]

describe('length', () => {
  it('matches closed forms for each primitive', () => {
    expect(curveLength(line(vec2(0, 0), vec2(3, 4)))).toBeCloseTo(5)
    expect(curveLength(arc(vec2(0, 0), 5, 0, Math.PI / 2, true))).toBeCloseTo((5 * Math.PI) / 2)
    expect(curveLength(polyline([vec2(0, 0), vec2(3, 0), vec2(3, 4)]))).toBeCloseTo(7)
    // A straight-line "cubic" has length equal to the chord.
    expect(curveLength(cubic(vec2(0, 0), vec2(1, 0), vec2(2, 0), vec2(3, 0)))).toBeCloseTo(3)
  })
})

describe('pointAt / tangentAt', () => {
  it('hits the endpoints at t=0 and t=1', () => {
    for (const c of samples) {
      const start = pointAt(c, 0)
      const end = pointAt(c, 1)
      expect(distance(start, endpointOf(c, 0))).toBeLessThan(1e-9)
      expect(distance(end, endpointOf(c, 1))).toBeLessThan(1e-9)
    }
  })

  it('returns unit tangents', () => {
    for (const c of samples) {
      for (const t of [0, 0.3, 0.7, 1]) {
        expect(vlength(tangentAt(c, t))).toBeCloseTo(1, 9)
      }
    }
  })
})

describe('curvatureAt', () => {
  it('is zero for straight primitives and 1/r for arcs', () => {
    expect(curvatureAt(line(vec2(0, 0), vec2(1, 1)), 0.5)).toBe(0)
    expect(curvatureAt(polyline([vec2(0, 0), vec2(1, 0)]), 0.5)).toBe(0)
    expect(curvatureAt(arc(vec2(0, 0), 4, 0, 1, true), 0.5)).toBeCloseTo(0.25)
    expect(curvatureAt(arc(vec2(0, 0), 4, 0, 1, false), 0.5)).toBeCloseTo(-0.25)
  })

  it('matches 1/r for a circular arc approximated as a cubic', () => {
    // A cubic tracing a quarter of a radius-10 circle reads κ ≈ 0.1 at the middle. The
    // Bézier isn't a perfect circle, so two decimals is the honest tolerance here.
    const k = 0.5522847498
    const c = cubic(vec2(10, 0), vec2(10, 10 * k), vec2(10 * k, 10), vec2(0, 10))
    expect(curvatureAt(c, 0.5)).toBeCloseTo(0.1, 2)
  })
})

describe('closestPoint', () => {
  it('projects onto a segment and clamps past the ends', () => {
    const l = line(vec2(0, 0), vec2(10, 0))
    expect(closestPoint(l, vec2(3, 5)).point).toEqual(vec2(3, 0))
    expect(closestPoint(l, vec2(-4, 1)).point).toEqual(vec2(0, 0))
    expect(closestPoint(l, vec2(99, 1)).point).toEqual(vec2(10, 0))
  })

  it('projects onto an arc and falls back to an endpoint outside the sweep', () => {
    const a = arc(vec2(0, 0), 5, 0, Math.PI / 2, true)
    const near = closestPoint(a, vec2(10, 10))
    expect(near.distance).toBeCloseTo(Math.hypot(10, 10) - 5, 6)
    // A point below the arc's sweep snaps to the start endpoint (5, 0).
    expect(closestPoint(a, vec2(6, -3)).point.x).toBeCloseTo(5)
    expect(closestPoint(a, vec2(6, -3)).point.y).toBeCloseTo(0)
  })

  it('handles a query at the arc centre without dividing by zero', () => {
    const a = arc(vec2(0, 0), 5, 0, Math.PI / 2, true)
    expect(closestPoint(a, vec2(0, 0)).distance).toBeCloseTo(5)
  })

  it('finds the nearest polyline segment', () => {
    const pl = polyline([vec2(0, 0), vec2(10, 0), vec2(10, 10)])
    expect(closestPoint(pl, vec2(5, -2)).point).toEqual(vec2(5, 0))
    expect(closestPoint(pl, vec2(13, 5)).point).toEqual(vec2(10, 5))
  })
})

describe('flatten', () => {
  it('returns the defining points for straight primitives', () => {
    expect(flattenCurve(line(vec2(0, 0), vec2(1, 1)), 0.1)).toEqual([vec2(0, 0), vec2(1, 1)])
    const plPts = [vec2(0, 0), vec2(1, 0), vec2(1, 1)]
    expect(flattenCurve(polyline(plPts), 0.1)).toEqual(plPts)
  })

  it('keeps every flattened arc point within tolerance of the circle', () => {
    const a = arc(vec2(0, 0), 20, 0, Math.PI, true)
    const pts = flattenCurve(a, 0.05)
    for (const p of pts) expect(Math.abs(vlength(p) - 20)).toBeLessThan(1e-6)
    // Chord midpoints must not sag more than the tolerance below the true radius.
    for (let i = 0; i < pts.length - 1; i++) {
      const mid = vec2((pts[i]!.x + pts[i + 1]!.x) / 2, (pts[i]!.y + pts[i + 1]!.y) / 2)
      expect(20 - vlength(mid)).toBeLessThanOrEqual(0.05 + 1e-9)
    }
  })

  it('rejects a non-positive tolerance', () => {
    expect(() => flattenCurve(cubic(vec2(0, 0), vec2(1, 1), vec2(2, 1), vec2(3, 0)), 0)).toThrow()
  })
})

describe('split preserves length (property, FR-4)', () => {
  it('sum of split-piece lengths equals the original within tolerance', () => {
    const rng = makeRng(12345)
    const makers = [rng.line, rng.arc, rng.cubic]
    for (let i = 0; i < 400; i++) {
      const curve = makers[i % makers.length]!()
      const t = rng.between(0.05, 0.95)
      const [left, right] = splitAt(curve, t)
      const whole = curveLength(curve)
      const parts = curveLength(left) + curveLength(right)
      expect(Math.abs(parts - whole)).toBeLessThan(1e-6 * (1 + whole))
    }
  })

  it('splits a polyline into two valid polylines sharing the cut point', () => {
    const pl = polyline([vec2(0, 0), vec2(10, 0), vec2(10, 10)])
    const [left, right] = splitAt(pl, 0.75) // 75% along a 20mm path → (10, 5)
    expect(left.kind).toBe('polyline')
    expect(right.kind).toBe('polyline')
    const cut = pointAt(pl, 0.75)
    expect(distance(pointAt(left, 1), cut)).toBeLessThan(1e-9)
    expect(distance(pointAt(right, 0), cut)).toBeLessThan(1e-9)
    // Both halves together retain the original length.
    expect(curveLength(left) + curveLength(right)).toBeCloseTo(curveLength(pl))
  })

  it('clamps an out-of-range split parameter', () => {
    const [left, right] = splitAt(line(vec2(0, 0), vec2(10, 0)), 1.5)
    expect(pointAt(left, 1)).toEqual(vec2(10, 0))
    expect(curveLength(right)).toBeCloseTo(0)
  })

  it('the split point is shared by both pieces and equals pointAt(t)', () => {
    const rng = makeRng(999)
    for (let i = 0; i < 200; i++) {
      const curve = [rng.line(), rng.arc(), rng.cubic()][i % 3]!
      const t = rng.between(0.1, 0.9)
      const [left, right] = splitAt(curve, t)
      const p = pointAt(curve, t)
      expect(distance(pointAt(left, 1), p)).toBeLessThan(1e-6)
      expect(distance(pointAt(right, 0), p)).toBeLessThan(1e-6)
    }
  })
})

function endpointOf(c: Curve, end: 0 | 1): ReturnType<typeof vec2> {
  switch (c.kind) {
    case 'line':
      return end === 0 ? c.a : c.b
    case 'cubic':
      return end === 0 ? c.p0 : c.p3
    case 'polyline':
      return end === 0 ? c.points[0]! : c.points[c.points.length - 1]!
    case 'arc':
      return arcPointAt(c, end)
  }
}
