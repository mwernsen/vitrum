import type { BBox } from '@vitrum/geometry'
import { vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { columnLabel, computeTiling, internalSeams, tileLabel } from './tiling'

function bounds(w: number, h: number): BBox {
  return { min: vec2(0, 0), max: vec2(w, h) }
}

// A4 portrait with 10 mm margins → 190 × 277 mm printable.
const A4 = { pageWidthMm: 210, pageHeightMm: 297, marginMm: 10, overlapMm: 15 }

describe('column labels', () => {
  it('are spreadsheet-style', () => {
    expect(columnLabel(0)).toBe('A')
    expect(columnLabel(25)).toBe('Z')
    expect(columnLabel(26)).toBe('AA')
    expect(tileLabel(1, 2)).toBe('B3')
  })
})

describe('computeTiling', () => {
  it('uses a single tile when the panel fits one printable sheet', () => {
    const t = computeTiling({ contentBounds: bounds(150, 200), ...A4 })
    expect(t.cols).toBe(1)
    expect(t.rows).toBe(1)
    expect(t.tiles).toHaveLength(1)
    expect(t.contentWidthMm).toBeCloseTo(190, 9)
    expect(t.contentHeightMm).toBeCloseTo(277, 9)
  })

  it('adds tiles with the overlap folded into the step', () => {
    // step = 190 - 15 = 175 across; 297 - 15 = 262 down.
    const t = computeTiling({ contentBounds: bounds(500, 600), ...A4 })
    expect(t.stepXMm).toBeCloseTo(175, 9)
    expect(t.stepYMm).toBeCloseTo(262, 9)
    // 500 wide: ceil((500-190)/175) = ceil(1.77) = 2 → 3 cols. 600 tall: ceil((600-277)/262)=2 → 3 rows.
    expect(t.cols).toBe(3)
    expect(t.rows).toBe(3)
    expect(t.tiles).toHaveLength(9)
  })

  it('covers the whole panel — the far corner lies within the last tile', () => {
    const t = computeTiling({ contentBounds: bounds(500, 600), ...A4 })
    const last = t.tiles[t.tiles.length - 1]!
    expect(last.worldRect.x + last.worldRect.w).toBeGreaterThanOrEqual(500)
    expect(last.worldRect.y + last.worldRect.h).toBeGreaterThanOrEqual(600)
  })

  it('adjacent tiles share exactly the overlap band', () => {
    const t = computeTiling({ contentBounds: bounds(500, 200), ...A4 })
    const a = t.tiles.find((x) => x.col === 0 && x.row === 0)!
    const b = t.tiles.find((x) => x.col === 1 && x.row === 0)!
    const overlap = a.worldRect.x + a.worldRect.w - b.worldRect.x
    expect(overlap).toBeCloseTo(15, 9)
  })

  it('throws when margins leave no printable area', () => {
    expect(() =>
      computeTiling({
        contentBounds: bounds(100, 100),
        pageWidthMm: 210,
        pageHeightMm: 297,
        marginMm: 150,
        overlapMm: 15,
      }),
    ).toThrow()
  })

  it('clamps an over-large overlap so the grid still terminates', () => {
    const t = computeTiling({
      contentBounds: bounds(500, 200),
      pageWidthMm: 210,
      pageHeightMm: 297,
      marginMm: 10,
      overlapMm: 999,
    })
    expect(t.stepXMm).toBeGreaterThan(0)
    expect(Number.isFinite(t.cols)).toBe(true)
  })
})

describe('internalSeams', () => {
  it('yields one seam per internal gridline, at the overlap-band centre', () => {
    const t = computeTiling({ contentBounds: bounds(500, 600), ...A4 })
    const seams = internalSeams(t)
    const vertical = seams.filter((s) => s.orientation === 'vertical')
    const horizontal = seams.filter((s) => s.orientation === 'horizontal')
    expect(vertical).toHaveLength(t.cols - 1)
    expect(horizontal).toHaveLength(t.rows - 1)
    // First vertical band centre: between col0 [0,190] and col1 [175,365] → centre of [175,190] = 182.5.
    expect(vertical[0]!.centreMm).toBeCloseTo(182.5, 9)
  })

  it('places each seam inside both neighbouring tiles (so both draw the crosshair)', () => {
    const t = computeTiling({ contentBounds: bounds(500, 200), ...A4 })
    const seam = internalSeams(t).find((s) => s.orientation === 'vertical')!
    const a = t.tiles.find((x) => x.col === 0)!
    const b = t.tiles.find((x) => x.col === 1)!
    for (const tile of [a, b]) {
      expect(seam.centreMm).toBeGreaterThanOrEqual(tile.worldRect.x)
      expect(seam.centreMm).toBeLessThanOrEqual(tile.worldRect.x + tile.worldRect.w)
    }
  })
})
