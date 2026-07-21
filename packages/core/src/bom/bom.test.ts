import { line, vec2, type BBox } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { pieceKey } from '../pieces/assignment'
import type { Piece } from '../pieces/types'
import type { CutContour, TechniqueSettings } from '../technique/types'

import { computeBom } from './bom'
import type { BomGlass, BomInput } from './types'

/**
 * F-042 FR-1: totals match hand-computed values for a reference panel — glass areas and came
 * lengths with shared-edge accounting (each interior lead line counted once, not per adjacent piece).
 * The geometry primitives (piece area/inset, curve length) are tested in F-020/F-021; here we hand-
 * build plain input data with known numbers and check the aggregation, grouping and waste maths.
 */

const bbox = (minX: number, minY: number, maxX: number, maxY: number): BBox => ({
  min: vec2(minX, minY),
  max: vec2(maxX, maxY),
})

function rect(x0: number, y0: number, x1: number, y1: number) {
  return [vec2(x0, y0), vec2(x1, y0), vec2(x1, y1), vec2(x0, y1)]
}

/** A piece with a known ring/bbox/area (boundary spans are unused by the BOM). */
function piece(id: string, ring: ReturnType<typeof rect>, area: number, box: BBox): Piece {
  return {
    id,
    boundary: [],
    holes: [],
    ring,
    holeRings: [],
    area,
    perimeter: 0,
    centroid: vec2(0, 0),
    bbox: box,
  }
}

function cut(pieceId: string, area: number, box: BBox, degenerate = false): CutContour {
  return { pieceId, ring: [], holeRings: [], area, bbox: box, degenerate }
}

const leadTechnique: TechniqueSettings = {
  kind: 'lead',
  lead: {
    defaultProfileId: 'p5',
    cuttingToleranceMm: 0.2,
    profiles: { p5: { id: 'p5', name: 'H 5 mm', kind: 'H', flangeMm: 5, heartMm: 1.5 } },
    overrides: {},
  },
  foil: { foilWidthMm: 5.6, pieceGapMm: 0.8, solderFinish: 'silver' },
}

// A 200 × 100 panel split vertically at x = 100 into two 100 × 100 pieces.
const pieceA = piece('pA', rect(0, 0, 100, 100), 10_000, bbox(0, 0, 100, 100))
const pieceB = piece('pB', rect(100, 0, 200, 100), 10_000, bbox(100, 0, 200, 100))
const keyA = pieceKey(pieceA)
const keyB = pieceKey(pieceB)

// Cut contours inset to a known 98.1 × 98.1 = 9 623.61 mm² each.
const cutA = cut('pA', 9_623.61, bbox(0.95, 0.95, 99.05, 99.05))
const cutB = cut('pB', 9_623.61, bbox(100.95, 0.95, 199.05, 99.05))

// Network segments — each drawn once, incl. the single interior divider shared by both pieces.
const segments = [
  {
    id: 's-bottom',
    geometry: line(vec2(0, 0), vec2(200, 0)),
    role: 'border' as const,
    endpoints: ['n1', 'n2'] as const,
  },
  {
    id: 's-right',
    geometry: line(vec2(200, 0), vec2(200, 100)),
    role: 'border' as const,
    endpoints: ['n2', 'n3'] as const,
  },
  {
    id: 's-top',
    geometry: line(vec2(200, 100), vec2(0, 100)),
    role: 'border' as const,
    endpoints: ['n3', 'n4'] as const,
  },
  {
    id: 's-left',
    geometry: line(vec2(0, 100), vec2(0, 0)),
    role: 'border' as const,
    endpoints: ['n4', 'n1'] as const,
  },
  {
    id: 's-divider',
    geometry: line(vec2(100, 0), vec2(100, 100)),
    role: 'lead' as const,
    endpoints: ['n5', 'n6'] as const,
  },
]

const glasses: Record<string, BomGlass> = {
  g1: {
    id: 'g1',
    name: 'Ruby',
    color: '#c0392b',
    thicknessMm: 3,
    manufacturer: 'Aurora',
    pricePerM2: 100,
    sheetSizes: [{ widthMm: 600, heightMm: 600, label: 'full' }],
  },
}

function baseInput(over: Partial<BomInput> = {}): BomInput {
  return {
    technique: leadTechnique,
    pieces: [pieceA, pieceB],
    cutContours: [cutA, cutB],
    segments,
    glasses,
    glassCodes: { g1: 'A' },
    glassByPiece: { [keyA]: 'g1', [keyB]: 'g1' },
    labelByPiece: { [keyA]: 'A1', [keyB]: 'A2' },
    reinforcements: [],
    factors: { glassWaste: 0.3, leadWaste: 0.1, solderGramsPerMetre: 20, foilRollLengthMm: 33_000 },
    weight: { grams: 500, glassGrams: 400, leadGrams: 100 },
    ...over,
  }
}

describe('computeBom — cutting list (FR-1)', () => {
  it('groups pieces per glass with cut-contour area/dims and waste-inflated buy area', () => {
    const report = computeBom(baseInput())
    expect(report.cutting).toHaveLength(1)
    const group = report.cutting[0]!
    expect(group.glassId).toBe('g1')
    expect(group.code).toBe('A')
    expect(group.name).toBe('Ruby')
    expect(group.color).toBe('#c0392b')
    expect(group.count).toBe(2)
    // Net glass area = sum of cut-contour areas (not drawn areas).
    expect(group.netAreaMm2).toBeCloseTo(19_247.22, 2)
    // Buy = net × (1 + 0.30).
    expect(group.buyAreaMm2).toBeCloseTo(25_021.386, 2)
    // Rows are the cut contours' bbox dims, sorted by number.
    expect(group.rows.map((r) => r.label)).toEqual(['A1', 'A2'])
    expect(group.rows[0]!.widthMm).toBeCloseTo(98.1, 5)
    expect(group.rows[0]!.heightMm).toBeCloseTo(98.1, 5)
    expect(group.rows[0]!.areaMm2).toBeCloseTo(9_623.61, 2)
    expect(group.pieceIds).toEqual(['pA', 'pB'])
  })

  it('falls back to the piece bbox/area when a cut contour is degenerate', () => {
    const report = computeBom(
      baseInput({ cutContours: [cut('pA', 0, bbox(0, 0, 0, 0), true), cutB] }),
    )
    const rowA = report.cutting[0]!.rows.find((r) => r.pieceId === 'pA')!
    expect(rowA.degenerate).toBe(true)
    expect(rowA.areaMm2).toBe(10_000) // piece area, not the degenerate contour's 0
    expect(rowA.widthMm).toBe(100)
  })

  it('puts unassigned pieces in a "?" bucket that sorts last', () => {
    const pieceC = piece('pC', rect(0, 100, 100, 200), 10_000, bbox(0, 100, 100, 200))
    const report = computeBom(
      baseInput({
        pieces: [pieceA, pieceB, pieceC],
        cutContours: [cutA, cutB, cut('pC', 9_000, bbox(0, 100, 98, 198))],
        labelByPiece: { [keyA]: 'A1', [keyB]: 'A2' }, // pC unnumbered
      }),
    )
    expect(report.cutting.map((g) => g.code)).toEqual(['A', '?'])
    const unassigned = report.cutting[1]!
    expect(unassigned.glassId).toBeNull()
    expect(unassigned.name).toBe('Unassigned')
    expect(unassigned.rows[0]!.label).toBe('')
  })
})

describe('computeBom — glass line items', () => {
  it('suggests the largest sheet and estimates cost from price per m²', () => {
    const report = computeBom(baseInput())
    const item = report.glass[0]!
    expect(item.sheet).toEqual({ widthMm: 600, heightMm: 600, label: 'full', sheetsNeeded: 1 })
    // cost = buyArea(m²) × price = (25021.386 / 1e6) × 100.
    expect(item.cost).toBeCloseTo(2.5021, 3)
  })

  it('omits sheet/cost when the glass has neither sheet sizes nor price', () => {
    const report = computeBom(
      baseInput({ glasses: { g1: { id: 'g1', name: 'Plain', color: '#fff' } } }),
    )
    expect(report.glass[0]!.sheet).toBeUndefined()
    expect(report.glass[0]!.cost).toBeUndefined()
  })
})

describe('computeBom — came lengths with shared-edge accounting (FR-1)', () => {
  it('counts each network segment once, incl. the shared interior divider', () => {
    const report = computeBom(baseInput())
    expect(report.came).toHaveLength(1) // all on the default profile
    const came = report.came[0]!
    // 200 + 100 + 200 + 100 (border) + 100 (divider counted once) = 700 mm.
    expect(came.netLengthMm).toBeCloseTo(700, 5)
    expect(came.buyLengthMm).toBeCloseTo(770, 5) // × 1.10
    expect(came.segmentIds).toHaveLength(5)
    expect(report.foil).toBeNull()
  })

  it('splits came into separate items per resolved profile (heavy perimeter came)', () => {
    const technique: TechniqueSettings = {
      ...leadTechnique,
      lead: {
        ...leadTechnique.lead,
        profiles: {
          ...leadTechnique.lead.profiles,
          p9: { id: 'p9', name: 'H 9 mm border', kind: 'H', flangeMm: 9, heartMm: 2 },
        },
        // Border segments use the heavier profile.
        overrides: {
          's-bottom': { profileId: 'p9' },
          's-right': { profileId: 'p9' },
          's-top': { profileId: 'p9' },
          's-left': { profileId: 'p9' },
        },
      },
    }
    const report = computeBom(baseInput({ technique }))
    const byProfile = Object.fromEntries(report.came.map((c) => [c.profileId, c.netLengthMm]))
    expect(byProfile['p9']).toBeCloseTo(600, 5) // the four border sides
    expect(byProfile['p5']).toBeCloseTo(100, 5) // the interior divider
  })
})

describe('computeBom — copper foil', () => {
  it('totals seam length, rolls and the documented solder estimate', () => {
    const report = computeBom(baseInput({ technique: { ...leadTechnique, kind: 'foil' } }))
    expect(report.technique).toBe('foil')
    expect(report.came).toEqual([])
    const foil = report.foil!
    expect(foil.netSeamLengthMm).toBeCloseTo(700, 5)
    expect(foil.buySeamLengthMm).toBeCloseTo(770, 5)
    expect(foil.rollsNeeded).toBe(1) // ceil(770 / 33000)
    expect(foil.solderGramsPerMetre).toBe(20)
    // 700 mm = 0.7 m × 20 g/m = 14 g.
    expect(foil.solderGrams).toBeCloseTo(14, 5)
  })
})

describe('computeBom — reinforcement and weight', () => {
  it('groups reinforcement bars by material with total length', () => {
    const report = computeBom(
      baseInput({
        reinforcements: [
          { id: 'r1', a: vec2(0, 50), b: vec2(200, 50), widthMm: 6, material: 'zinc' },
          { id: 'r2', a: vec2(0, 20), b: vec2(100, 20), widthMm: 6, material: 'zinc' },
          { id: 'r3', a: vec2(0, 80), b: vec2(50, 80), widthMm: 6, material: 'steel' },
        ],
      }),
    )
    const zinc = report.reinforcement.find((r) => r.material === 'zinc')!
    expect(zinc.count).toBe(2)
    expect(zinc.totalLengthMm).toBeCloseTo(300, 5) // 200 + 100
    expect(zinc.barIds).toEqual(['r1', 'r2'])
    expect(report.reinforcement.find((r) => r.material === 'steel')!.totalLengthMm).toBeCloseTo(
      50,
      5,
    )
  })

  it('passes the injected panel weight through unchanged', () => {
    const report = computeBom(baseInput())
    expect(report.weight).toEqual({ grams: 500, glassGrams: 400, leadGrams: 100 })
  })
})
