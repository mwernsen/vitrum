import { vec2, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { collides, dilate, getBit, makeSheet, popcount, rasterizeRings, stamp } from './raster'

/** A unit square [0,10]² as a CCW ring. */
const square = (s: number): Vec2[] => [vec2(0, 0), vec2(s, 0), vec2(s, s), vec2(0, s)]

describe('rasterizeRings', () => {
  it('fills the interior of a simple square', () => {
    const m = rasterizeRings([square(10)], 1, 0, 0, 10, 10)
    expect(getBit(m, 5, 5)).toBe(true)
    expect(getBit(m, 0, 0)).toBe(true)
    // Roughly the whole 10×10 area is filled.
    expect(popcount(m)).toBe(100)
  })

  it('leaves a hole empty (even-odd over all rings)', () => {
    const outer = square(20)
    const hole: Vec2[] = [vec2(6, 6), vec2(14, 6), vec2(14, 14), vec2(6, 14)]
    const m = rasterizeRings([outer, hole], 1, 0, 0, 20, 20)
    expect(getBit(m, 2, 2)).toBe(true) // in the frame
    expect(getBit(m, 10, 10)).toBe(false) // in the hole
  })
})

describe('collides / stamp', () => {
  it('detects overlap after a piece is stamped, and clear space elsewhere', () => {
    const sheet = makeSheet(64, 32)
    const piece = rasterizeRings([square(10)], 1, 0, 0, 10, 10)
    // Empty sheet: no collision anywhere it fits.
    expect(collides(sheet, piece, 0, 0)).toBe(false)
    stamp(sheet, piece, 0, 0)
    // Overlapping placement collides; a shifted, non-overlapping one does not.
    expect(collides(sheet, piece, 5, 5)).toBe(true)
    expect(collides(sheet, piece, 12, 0)).toBe(false)
  })

  it('collision works across a 32-bit word boundary (bit-shift correctness)', () => {
    const sheet = makeSheet(80, 8)
    const piece = rasterizeRings([square(8)], 1, 0, 0, 8, 8)
    stamp(sheet, piece, 30, 0) // straddles the word boundary at bit 32
    expect(collides(sheet, piece, 33, 0)).toBe(true)
    expect(collides(sheet, piece, 40, 0)).toBe(false)
  })
})

describe('dilate', () => {
  it('grows the footprint by the given radius', () => {
    const m = rasterizeRings([square(4)], 1, 0, 0, 4, 4)
    const before = popcount(m)
    const grown = dilate(m, 1)
    expect(popcount(grown)).toBeGreaterThan(before)
    expect(grown.cols).toBe(m.cols + 2)
    expect(grown.rows).toBe(m.rows + 2)
  })
})
