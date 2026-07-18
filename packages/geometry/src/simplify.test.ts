import { describe, expect, it } from 'vitest'

import { douglasPeucker, removeCollinear, simplifyPolyline } from './simplify'
import { polyline } from './types'
import { vec2 } from './vec2'

describe('douglasPeucker', () => {
  it('drops points within tolerance of the spanning line', () => {
    // A nearly-straight run collapses to its endpoints.
    const pts = [vec2(0, 0), vec2(1, 0.001), vec2(2, -0.001), vec2(3, 0)]
    expect(douglasPeucker(pts, 0.01)).toEqual([vec2(0, 0), vec2(3, 0)])
  })

  it('keeps a point that deviates beyond tolerance', () => {
    const pts = [vec2(0, 0), vec2(1, 1), vec2(2, 0)]
    expect(douglasPeucker(pts, 0.5)).toEqual(pts)
  })

  it('returns short inputs unchanged and rejects a negative tolerance', () => {
    expect(douglasPeucker([vec2(0, 0), vec2(1, 1)], 0.1)).toEqual([vec2(0, 0), vec2(1, 1)])
    expect(() => douglasPeucker([vec2(0, 0), vec2(1, 1), vec2(2, 2)], -1)).toThrow()
  })

  it('simplifyPolyline wraps the point simplification', () => {
    const pl = polyline([vec2(0, 0), vec2(1, 0.0001), vec2(2, 0)])
    expect(simplifyPolyline(pl, 0.01).points).toEqual([vec2(0, 0), vec2(2, 0)])
  })
})

describe('removeCollinear', () => {
  it('removes redundant collinear interior vertices, keeping endpoints (open)', () => {
    const pts = [vec2(0, 0), vec2(1, 0), vec2(2, 0), vec2(2, 2)]
    expect(removeCollinear(pts)).toEqual([vec2(0, 0), vec2(2, 0), vec2(2, 2)])
  })

  it('removes exact duplicates', () => {
    const pts = [vec2(0, 0), vec2(0, 0), vec2(1, 0), vec2(2, 0)]
    expect(removeCollinear(pts)).toEqual([vec2(0, 0), vec2(2, 0)])
  })

  it('treats the ring as closed when asked, simplifying across the wrap', () => {
    // A square ring with a redundant midpoint on the bottom edge.
    const ring = [vec2(0, 0), vec2(5, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)]
    const out = removeCollinear(ring, 1e-6, true)
    expect(out).toEqual([vec2(0, 0), vec2(10, 0), vec2(10, 10), vec2(0, 10)])
  })

  it('leaves a triangle untouched', () => {
    const tri = [vec2(0, 0), vec2(4, 0), vec2(2, 3)]
    expect(removeCollinear(tri, 1e-6, true)).toEqual(tri)
  })
})
