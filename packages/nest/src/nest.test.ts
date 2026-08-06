import { overlapArea, vec2, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { bboxBaseline } from './baseline'
import { nestSheets } from './nest'
import { rotationsFor } from './rotation'
import type { NestGlassInput, NestInput, NestPart, NestSheet } from './types'

/** A right triangle with legs `L` on the axes: (0,0)-(L,0)-(0,L). Two of them tile an L×L square. */
function triangle(id: string, glassId: string, L: number, label = id): NestPart {
  return { id, label, glassId, ring: [vec2(0, 0), vec2(L, 0), vec2(0, L)], holes: [] }
}

/** A W×H rectangle part at the origin. */
function rect(id: string, glassId: string, w: number, h: number): NestPart {
  return {
    id,
    label: id,
    glassId,
    ring: [vec2(0, 0), vec2(w, 0), vec2(w, h), vec2(0, h)],
    holes: [],
  }
}

function glass(
  glassId: string,
  w: number,
  h: number,
  rotation: NestGlassInput['rotation'],
): NestGlassInput {
  return { glassId, sheet: { widthMm: w, heightMm: h }, rotation }
}

function allPlaced(
  sheets: readonly NestSheet[],
): { part: NestSheet['parts'][number]; sheet: number }[] {
  return sheets.flatMap((s) => s.parts.map((part) => ({ part, sheet: s.index })))
}

/** Minimum distance between two convex-ish polygons via edge-pair sampling (small polys only). */
function minPolyDistance(a: readonly Vec2[], b: readonly Vec2[]): number {
  let best = Infinity
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!
    const a1 = a[(i + 1) % a.length]!
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j]!
      const b1 = b[(j + 1) % b.length]!
      best = Math.min(best, segSegDist(a0, a1, b0, b1))
    }
  }
  return best
}

function segSegDist(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): number {
  const d = (a: Vec2, b: Vec2, p: Vec2): number => {
    const vx = b.x - a.x
    const vy = b.y - a.y
    const wx = p.x - a.x
    const wy = p.y - a.y
    const len2 = vx * vx + vy * vy
    const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0
    const cx = a.x + t * vx
    const cy = a.y + t * vy
    return Math.hypot(p.x - cx, p.y - cy)
  }
  return Math.min(d(p1, p2, p3), d(p1, p2, p4), d(p3, p4, p1), d(p3, p4, p2))
}

describe('nestSheets — FR-1 (spacing, rotation & grain constraints)', () => {
  it('keeps every placed piece inside its sheet, non-overlapping and grain-respecting', () => {
    const parts: NestPart[] = Array.from({ length: 6 }, (_, i) => triangle(`t${i}`, 'g', 40))
    const input: NestInput = {
      parts,
      glasses: [glass('g', 100, 100, 'flip')],
      spacingMm: 4,
      seed: 1,
    }
    const result = nestSheets(input)
    const g = result.glasses[0]!
    expect(g.unplaced).toEqual([])

    const allowed = rotationsFor('flip')
    for (const sheet of g.sheets) {
      // Every piece within the sheet bounds.
      for (const p of sheet.parts) {
        // Grain: only 0/180° for a streaky glass.
        expect(allowed).toContain(p.rotationDeg)
        for (const v of p.ring) {
          expect(v.x).toBeGreaterThanOrEqual(-1e-6)
          expect(v.y).toBeGreaterThanOrEqual(-1e-6)
          expect(v.x).toBeLessThanOrEqual(sheet.widthMm + 1e-6)
          expect(v.y).toBeLessThanOrEqual(sheet.heightMm + 1e-6)
        }
      }
      // No two pieces on the same sheet overlap, and a real gap separates them (≈ spacing).
      for (let i = 0; i < sheet.parts.length; i++) {
        for (let j = i + 1; j < sheet.parts.length; j++) {
          const a = sheet.parts[i]!.ring
          const b = sheet.parts[j]!.ring
          expect(overlapArea(a, b)).toBeLessThan(1e-6)
          expect(minPolyDistance(a, b)).toBeGreaterThan(input.spacingMm * 0.5)
        }
      }
    }
  })

  it('a fixed-rotation (0°) glass leaves every piece upright', () => {
    const parts = [rect('a', 'g', 30, 20), rect('b', 'g', 30, 20), rect('c', 'g', 30, 20)]
    const result = nestSheets({
      parts,
      glasses: [glass('g', 120, 120, 'fixed')],
      spacingMm: 2,
      seed: 3,
    })
    for (const p of allPlaced(result.glasses[0]!.sheets)) expect(p.part.rotationDeg).toBe(0)
  })

  it('flags a piece larger than its sheet as unplaced instead of forcing it', () => {
    const parts = [rect('big', 'g', 200, 200)]
    const result = nestSheets({
      parts,
      glasses: [glass('g', 100, 100, 'fixed')],
      spacingMm: 2,
      seed: 1,
    })
    expect(result.glasses[0]!.unplaced).toEqual(['big'])
    expect(result.glasses[0]!.sheetCount).toBe(0)
  })
})

describe('nestSheets — FR-2 (beats naive bbox packing)', () => {
  it('interlocks complementary triangles to use fewer sheets than a bbox baseline', () => {
    // 8 right triangles (two tile an L×L square). A naive bbox packer treats each as a full L×L box
    // and shelf-packs them loosely; the raster nester interlocks 0°/180° pieces and packs the whole
    // batch onto one sheet where the baseline needs two.
    const parts: NestPart[] = Array.from({ length: 8 }, (_, i) => triangle(`t${i}`, 'g', 40))
    const input: NestInput = {
      parts,
      glasses: [glass('g', 120, 120, 'flip')],
      spacingMm: 2,
      seed: 1,
    }
    const nested = nestSheets(input)
    const baseline = bboxBaseline(input)

    expect(nested.glasses[0]!.unplaced).toEqual([])
    expect(nested.totalSheets).toBeLessThan(baseline.totalSheets)
    // Utilisation is placedArea / (sheets · sheetArea); fewer sheets ⇒ strictly higher utilisation.
    const sheetArea = 120 * 120
    const partArea = 8 * (40 * 40) * 0.5
    const nestUtil = partArea / (nested.totalSheets * sheetArea)
    expect(nestUtil).toBeGreaterThan(baseline.utilization + 0.1)
  })
})

describe('nestSheets — FR-3 (reproducible from seed)', () => {
  const parts: NestPart[] = [
    triangle('t0', 'g', 40),
    triangle('t1', 'g', 40),
    rect('r0', 'g', 25, 55),
    rect('r1', 'g', 35, 20),
    triangle('t2', 'g', 30),
  ]
  const base: NestInput = {
    parts,
    glasses: [glass('g', 120, 120, 'quadrant')],
    spacingMm: 3,
    seed: 42,
  }

  it('is byte-identical for the same seed', () => {
    expect(nestSheets(base)).toEqual(nestSheets(base))
  })

  it('the stored seed rides on the result', () => {
    expect(nestSheets(base).seed).toBe(42)
  })

  it('a different seed is allowed to differ but stays valid', () => {
    const a = nestSheets(base)
    const b = nestSheets({ ...base, seed: 7 })
    // Both place everything; the layouts may differ.
    expect(a.glasses[0]!.unplaced).toEqual([])
    expect(b.glasses[0]!.unplaced).toEqual([])
  })
})

describe('nestSheets — FR-2 (runs well under 30 s)', () => {
  it('nests 40 mixed pieces on a full 610×914 sheet quickly', () => {
    const parts: NestPart[] = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0
        ? triangle(`t${i}`, 'g', 40 + (i % 5) * 15)
        : rect(`r${i}`, 'g', 40 + (i % 4) * 20, 60),
    )
    const input: NestInput = {
      parts,
      glasses: [glass('g', 610, 914, 'quadrant')],
      spacingMm: 3,
      seed: 1,
    }
    const t0 = performance.now()
    const result = nestSheets(input)
    const elapsed = performance.now() - t0
    expect(result.glasses[0]!.unplaced).toEqual([])
    expect(elapsed).toBeLessThan(30_000)
  })
})

describe('nestSheets — progress & grouping', () => {
  it('reports progress ending at fraction 1, and groups pieces by glass', () => {
    const parts = [rect('a', 'g1', 30, 30), rect('b', 'g2', 30, 30), rect('c', 'g1', 30, 30)]
    const input: NestInput = {
      parts,
      glasses: [glass('g1', 100, 100, 'fixed'), glass('g2', 100, 100, 'fixed')],
      spacingMm: 2,
      seed: 1,
    }
    const seen: number[] = []
    const result = nestSheets(input, (p) => seen.push(p.fraction))
    expect(seen[seen.length - 1]).toBe(1)
    expect(result.glasses.map((g) => g.glassId)).toEqual(['g1', 'g2'])
    expect(result.glasses[0]!.sheets[0]!.parts.length).toBe(2) // a + c
    expect(result.glasses[1]!.sheets[0]!.parts.length).toBe(1) // b
    expect(result.totalSheets).toBe(2)
  })
})

describe('placement strategy (F-057 nest rework)', () => {
  /** Pieces with clearly different width/height profiles, so the orderings genuinely differ. */
  const parts: NestPart[] = [
    rect('wide', 'g', 180, 30),
    rect('tall', 'g', 30, 180),
    rect('big', 'g', 120, 120),
    rect('small', 'g', 40, 40),
  ]
  const input = (strategy?: NestInput['strategy']): NestInput => ({
    parts,
    glasses: [glass('g', 400, 400, 'fixed')],
    spacingMm: 2,
    seed: 5,
    ...(strategy ? { strategy } : {}),
  })

  it('defaults to `fewest`, so an input without a strategy nests exactly as before', () => {
    expect(nestSheets(input())).toEqual(nestSheets(input('fewest')))
  })

  it('places every piece whichever order is used', () => {
    for (const s of ['fewest', 'tight', 'fast'] as const) {
      const g = nestSheets(input(s)).glasses[0]!
      expect(g.unplaced).toEqual([])
      expect(g.sheets.flatMap((sh) => sh.parts)).toHaveLength(parts.length)
    }
  })

  it('lays the pieces out differently: tallest first vs. widest first', () => {
    const first = (s: NestInput['strategy']): string =>
      nestSheets(input(s)).glasses[0]!.sheets[0]!.parts[0]!.id
    // `tight` keys on height, so the 30 × 180 piece leads; `fast` keys on width, so the 180 × 30 does.
    expect(first('tight')).toBe('tall')
    expect(first('fast')).toBe('wide')
    // `fewest` keys on area, so the biggest piece leads.
    expect(first('fewest')).toBe('big')
  })

  it('is reproducible: the same strategy and seed give the same layout (FR-3)', () => {
    expect(nestSheets(input('tight'))).toEqual(nestSheets(input('tight')))
  })
})
