import type { BBox } from '@vitrum/geometry'
import { vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { GridIndex } from './spatialIndex'

function box(x0: number, y0: number, x1: number, y1: number): BBox {
  return { min: vec2(x0, y0), max: vec2(x1, y1) }
}

describe('GridIndex', () => {
  it('returns items whose cells overlap the query window', () => {
    const boxes = [box(0, 0, 10, 10), box(100, 100, 110, 110), box(5, 5, 15, 15)]
    const index = GridIndex.build(boxes)
    const hits = index.query(box(0, 0, 12, 12)).sort((a, b) => a - b)
    expect(hits).toContain(0)
    expect(hits).toContain(2)
    expect(hits).not.toContain(1)
  })

  it('never returns an item twice even when it spans many cells', () => {
    const index = GridIndex.build([box(0, 0, 100, 100)], 10)
    const hits = index.query(box(0, 0, 100, 100))
    expect(hits).toEqual([0])
  })

  it('holds oversized items apart and always includes them', () => {
    // A tiny cell so the 2e5-long box is oversized; a normal box shares the grid.
    const index = GridIndex.build([box(0, 0, 1, 1), box(-1e5, -1e5, 1e5, 1e5)], 1)
    expect(index.oversizedCount).toBe(1)
    // A far-away window still returns the oversized item (an infinite guide always snaps).
    expect(index.query(box(500, 500, 501, 501))).toEqual([1])
  })

  it('query cost is local: a small window over a 5,000-segment lattice returns few items (FR-4)', () => {
    // A 71×71 lattice of 20 mm cells (~5,000 small boxes), like the pan/zoom stress scene.
    const boxes: BBox[] = []
    const cols = 71
    for (let i = 0; i < 5000; i++) {
      const x = (i % cols) * 20
      const y = Math.floor(i / cols) * 20
      boxes.push(box(x, y, x + 20, y + 20))
    }
    const index = GridIndex.build(boxes)
    // A window the size of a snap radius, deep inside the lattice.
    const candidates = index.query(box(700, 700, 716, 716))
    expect(candidates.length).toBeGreaterThan(0)
    // The count is bounded by the local neighbourhood, not the 5,000 total.
    expect(candidates.length).toBeLessThan(40)
  })
})
