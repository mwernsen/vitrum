import { describe, expect, it } from 'vitest'

import type { BomReport } from '../bom/types'

import { computeQuote, pieceComplexity } from './quote'
import type { QuoteInput, QuotePieceMetric, QuotePriceBook } from './types'

/**
 * F-056 FR-1: `computeQuote` is a pure, deterministic function — its totals reproduce to the cent on
 * a reference panel. The BOM below is a hand-built fixture (the F-042 calc is tested separately); the
 * quote arithmetic is checked against values worked out by hand in the comments.
 */

const currency = { code: 'EUR', symbol: '€' }

const priceBook: QuotePriceBook = {
  leadPerMetre: 3.5,
  foilPerMetre: 1.2,
  solderPerKg: 28,
  reinforcementPerMetre: 6,
  consumables: [{ id: 'con-flux', name: 'Flux & patina', cost: 5 }],
}

const labor = {
  hourlyRate: 45,
  setupHours: 2,
  minutesPerPiece: 12,
  minutesPerSeamMetre: 15,
  minutesPerComplexity: 8,
  foilPieceFactor: 1.4,
}

/** A rectangular piece (perimeter == bbox perimeter → complexity 0) and a curvier one (0.25). */
const pieces: QuotePieceMetric[] = [
  {
    contentId: 'c1',
    pieceId: 'p1',
    label: 'A1',
    glassId: 'gA',
    areaMm2: 5000, // 100 × 50 → the larger piece
    perimeterMm: 300,
    bboxWidthMm: 100,
    bboxHeightMm: 50,
  },
  {
    contentId: 'c2',
    pieceId: 'p2',
    label: 'B1',
    glassId: 'gB',
    areaMm2: 1600, // 40 × 40 → the smaller piece
    perimeterMm: 200, // vs bbox perimeter 160 → complexity 0.25
    bboxWidthMm: 40,
    bboxHeightMm: 40,
  },
]

/** A lead-technique BOM: priced glass A, unpriced glass B, one came profile, one reinforcement bar. */
function leadBom(): BomReport {
  return {
    technique: 'lead',
    cutting: [],
    glass: [
      {
        glassId: 'gA',
        code: 'A',
        name: 'Clear',
        count: 1,
        netAreaMm2: 400_000,
        buyAreaMm2: 500_000, // 0.5 m²
        cost: 10, // 0.5 m² × €20/m²
        pieceIds: ['p1'],
      },
      {
        glassId: 'gB',
        code: 'B',
        name: 'Ruby',
        count: 1,
        netAreaMm2: 160_000,
        buyAreaMm2: 200_000,
        cost: undefined, // no price set
        pieceIds: ['p2'],
      },
    ],
    came: [
      {
        profileId: 'came-h-5',
        name: 'H 5mm',
        kind: 'H',
        flangeMm: 5,
        heartMm: 1,
        netLengthMm: 4000, // 4 m of seam
        buyLengthMm: 5000, // 5 m to buy
        segmentIds: ['s1', 's2'],
      },
    ],
    foil: null,
    reinforcement: [{ material: 'zinc', count: 1, totalLengthMm: 300, barIds: ['b1'] }],
    weight: { grams: 0, glassGrams: 0, leadGrams: 0 },
    factors: { glassWaste: 0.3, leadWaste: 0.1, solderGramsPerMetre: 20, foilRollLengthMm: 33_000 },
    pieceCount: 2,
  }
}

function leadInput(): QuoteInput {
  return {
    bom: leadBom(),
    currency,
    priceBook,
    labor,
    overheadPct: 0.15,
    marginPct: 0.3,
    manualLines: [],
    pieces,
  }
}

describe('computeQuote', () => {
  it('prices materials from the BOM + price book, flagging unpriced glass', () => {
    const q = computeQuote(leadInput())
    // Glass A priced (€10), glass B unpriced (€0, flagged).
    expect(q.materials.glass[0]!.amount).toBe(10)
    expect(q.materials.glass[1]!.amount).toBe(0)
    expect(q.materials.glass[1]!.unpriced).toBe(true)
    expect(q.hasUnpricedGlass).toBe(true)
    // Came 5 m × €3.5 = €17.5; reinforcement 0.3 m × €6 = €1.8; consumable €5.
    expect(q.materials.lead[0]!.amount).toBeCloseTo(17.5, 10)
    expect(q.materials.reinforcement[0]!.amount).toBeCloseTo(1.8, 10)
    expect(q.materials.consumables[0]!.amount).toBe(5)
    // Materials subtotal = 10 + 0 + 17.5 + 1.8 + 5 = 34.3.
    expect(q.materials.subtotal).toBeCloseTo(34.3, 10)
  })

  it('estimates labor transparently: setup + per-piece + per-seam-metre', () => {
    const q = computeQuote(leadInput())
    // Piece minutes: p1 = 12 (complexity 0), p2 = 12 + 8×0.25 = 14 → 26 min = 0.4333 h.
    expect(q.labor.pieceHours).toBeCloseTo(26 / 60, 10)
    // Seam: 4 m × 15 min/m = 60 min = 1 h. Setup = 2 h. Total = 3.4333 h.
    expect(q.labor.seamMetres).toBeCloseTo(4, 10)
    expect(q.labor.seamHours).toBeCloseTo(1, 10)
    expect(q.labor.hours).toBeCloseTo(2 + 26 / 60 + 1, 10)
    // Cost: 90 (setup) + 19.5 (pieces) + 45 (seam) = 154.5.
    expect(q.labor.cost).toBeCloseTo(154.5, 10)
    expect(q.labor.pieceFactor).toBe(1)
  })

  it('computes overhead, margin and grand total as markups on cost (Decision §2)', () => {
    const q = computeQuote(leadInput())
    // Subtotal = 34.3 + 154.5 = 188.8.
    expect(q.subtotal).toBeCloseTo(188.8, 10)
    // Overhead 15% = 28.32; margin 30% of (188.8+28.32=217.12) = 65.136; total = 282.256.
    expect(q.overhead).toBeCloseTo(28.32, 10)
    expect(q.margin).toBeCloseTo(65.136, 10)
    expect(q.total).toBeCloseTo(282.256, 10)
  })

  it('is deterministic: identical input → identical totals', () => {
    expect(computeQuote(leadInput()).total).toBe(computeQuote(leadInput()).total)
  })

  it('orders the per-piece labor rows smallest-first for the sensitivity view (FR-6)', () => {
    const q = computeQuote(leadInput())
    expect(q.labor.perPiece.map((p) => p.pieceId)).toEqual(['p2', 'p1'])
    // The smallest piece (p2) carries its per-piece labor; smallest-N sums are the sensitivity figure.
    expect(q.labor.perPiece[0]!.cost).toBeCloseTo((14 / 60) * 45, 10)
  })

  it('adds manual line items (including negative discounts) into the subtotal', () => {
    const input = leadInput()
    const q = computeQuote({
      ...input,
      manualLines: [
        { id: 'l1', description: 'Installation', amount: 150 },
        { id: 'l2', description: 'Repeat-client discount', amount: -20 },
      ],
    })
    expect(q.manualSubtotal).toBe(130)
    expect(q.subtotal).toBeCloseTo(188.8 + 130, 10)
  })

  it('prices copper foil + solder and applies the foil per-piece factor', () => {
    const input = leadInput()
    const bom: BomReport = {
      ...input.bom,
      technique: 'foil',
      came: [],
      foil: {
        netSeamLengthMm: 4000,
        buySeamLengthMm: 4400,
        rollLengthMm: 33_000,
        rollsNeeded: 1,
        solderGramsPerMetre: 20,
        solderGrams: 80, // 0.08 kg
        segmentIds: ['s1', 's2'],
      },
    }
    const q = computeQuote({ ...input, bom })
    // Tape 4.4 m × €1.2 = €5.28; solder 0.08 kg × €28 = €2.24.
    expect(q.materials.foil[0]!.amount).toBeCloseTo(5.28, 10)
    expect(q.materials.foil[1]!.amount).toBeCloseTo(2.24, 10)
    expect(q.materials.lead).toEqual([])
    // Foil per-piece factor ×1.4: p1 = 1.4×12 = 16.8 min.
    expect(q.labor.pieceFactor).toBe(1.4)
    const p1 = q.labor.perPiece.find((p) => p.pieceId === 'p1')!
    expect(p1.minutes).toBeCloseTo(1.4 * 12, 10)
  })
})

describe('pieceComplexity', () => {
  it('scores a rectangle ~0 and a curve-heavy piece higher', () => {
    expect(
      pieceComplexity({
        contentId: 'x',
        pieceId: 'x',
        label: '',
        glassId: null,
        areaMm2: 1,
        perimeterMm: 300,
        bboxWidthMm: 100,
        bboxHeightMm: 50,
      }),
    ).toBe(0)
    expect(
      pieceComplexity({
        contentId: 'y',
        pieceId: 'y',
        label: '',
        glassId: null,
        areaMm2: 1,
        perimeterMm: 200,
        bboxWidthMm: 40,
        bboxHeightMm: 40,
      }),
    ).toBeCloseTo(0.25, 10)
  })

  it('is 0 for a degenerate bounding box', () => {
    expect(
      pieceComplexity({
        contentId: 'z',
        pieceId: 'z',
        label: '',
        glassId: null,
        areaMm2: 0,
        perimeterMm: 10,
        bboxWidthMm: 0,
        bboxHeightMm: 0,
      }),
    ).toBe(0)
  })
})
