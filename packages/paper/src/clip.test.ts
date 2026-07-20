import { vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { clipPolygon, clipPolyline } from './clip'
import type { RectMm } from './page'

const RECT: RectMm = { x: 0, y: 0, w: 100, h: 100 }

describe('clipPolyline', () => {
  it('keeps a fully-inside polyline unchanged', () => {
    const runs = clipPolyline([vec2(10, 10), vec2(90, 90)], RECT)
    expect(runs).toEqual([[vec2(10, 10), vec2(90, 90)]])
  })

  it('drops a fully-outside polyline', () => {
    expect(clipPolyline([vec2(-50, -50), vec2(-10, -10)], RECT)).toEqual([])
  })

  it('trims a line entering the rectangle to the boundary', () => {
    const runs = clipPolyline([vec2(-50, 50), vec2(50, 50)], RECT)
    expect(runs).toHaveLength(1)
    expect(runs[0]![0]!.x).toBeCloseTo(0, 9)
    expect(runs[0]![1]!.x).toBeCloseTo(50, 9)
  })

  it('splits a polyline that leaves and re-enters into separate runs', () => {
    // Zig-zag exiting the top and coming back.
    const runs = clipPolyline([vec2(10, 50), vec2(50, -20), vec2(90, 50)], RECT)
    expect(runs.length).toBe(2)
  })
})

describe('clipPolygon', () => {
  it('keeps a fully-inside polygon', () => {
    const ring = [vec2(10, 10), vec2(90, 10), vec2(90, 90), vec2(10, 90)]
    expect(clipPolygon(ring, RECT)).toHaveLength(4)
  })

  it('clips a polygon straddling one edge to the rectangle', () => {
    const ring = [vec2(50, 50), vec2(150, 50), vec2(150, 90), vec2(50, 90)]
    const out = clipPolygon(ring, RECT)
    expect(out.length).toBeGreaterThanOrEqual(4)
    for (const p of out) expect(p.x).toBeLessThanOrEqual(100 + 1e-9)
  })

  it('drops a polygon entirely outside', () => {
    const ring = [vec2(200, 200), vec2(300, 200), vec2(300, 300)]
    expect(clipPolygon(ring, RECT)).toEqual([])
  })
})
