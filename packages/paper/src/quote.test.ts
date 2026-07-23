import { computeQuote, type BomReport, type QuoteReport } from '@vitrum/core'
import { describe, expect, it } from 'vitest'

import { forEachOp, type DrawOp, type PdfDoc } from './page'
import { renderPdf } from './pdf'
import { buildQuoteDocument, type QuoteDocOptions } from './quote'

/** Decode base64 to bytes without Node's `Buffer` (paper's tsconfig has no node types). */
function base64ToBytes(s: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const ch of s.replace(/=+$/, '')) {
    const idx = alphabet.indexOf(ch)
    if (idx === -1) continue
    buffer = (buffer << 6) | idx
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return Uint8Array.from(out)
}

/** A 1×1 PNG (valid, so pdf-lib can embed it) for the panel-image path. */
const PNG_1x1 = base64ToBytes(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
)

function report(): QuoteReport {
  const bom: BomReport = {
    technique: 'lead',
    cutting: [],
    glass: [
      {
        glassId: 'gA',
        code: 'A',
        name: 'Clear',
        count: 1,
        netAreaMm2: 400_000,
        buyAreaMm2: 500_000,
        cost: 10,
        pieceIds: ['p1'],
      },
    ],
    came: [
      {
        profileId: 'came-h-5',
        name: 'H 5mm',
        kind: 'H',
        flangeMm: 5,
        heartMm: 1,
        netLengthMm: 4000,
        buyLengthMm: 5000,
        segmentIds: ['s1'],
      },
    ],
    foil: null,
    reinforcement: [],
    weight: { grams: 0, glassGrams: 0, leadGrams: 0 },
    factors: { glassWaste: 0.3, leadWaste: 0.1, solderGramsPerMetre: 20, foilRollLengthMm: 33_000 },
    pieceCount: 1,
  }
  return computeQuote({
    bom,
    currency: { code: 'EUR', symbol: '€' },
    priceBook: {
      leadPerMetre: 3.5,
      foilPerMetre: 1.2,
      solderPerKg: 28,
      reinforcementPerMetre: 6,
      consumables: [],
    },
    labor: {
      hourlyRate: 45,
      setupHours: 2,
      minutesPerPiece: 12,
      minutesPerSeamMetre: 15,
      minutesPerComplexity: 8,
      foilPieceFactor: 1.4,
    },
    overheadPct: 0.15,
    marginPct: 0.3,
    manualLines: [{ id: 'l1', description: 'Installation', amount: 150 }],
    pieces: [
      {
        contentId: 'c1',
        pieceId: 'p1',
        label: 'A1',
        glassId: 'gA',
        areaMm2: 5000,
        perimeterMm: 300,
        bboxWidthMm: 100,
        bboxHeightMm: 50,
      },
    ],
  })
}

const baseOptions: QuoteDocOptions = {
  projectName: 'Sample panel',
  unit: 'mm',
  client: {
    clientName: 'Jane Doe',
    projectTitle: 'Rose window',
    quoteNumber: 'Q-2026-014',
    notes: 'Valid for 30 days.',
  },
  date: '2026-07-22',
}

function allText(doc: PdfDoc): string[] {
  const texts: string[] = []
  for (const page of doc.pages) {
    forEachOp(page.ops, (op: DrawOp) => {
      if (op.kind === 'text') texts.push(op.text)
    })
  }
  return texts
}

describe('buildQuoteDocument', () => {
  it('emits an A4 page with the project title, client and total (client view)', () => {
    const doc = buildQuoteDocument(report(), baseOptions)
    expect(doc.pages.length).toBeGreaterThanOrEqual(1)
    expect(doc.pages[0]!.widthMm).toBeCloseTo(210, 1)
    const texts = allText(doc)
    expect(texts).toContain('Rose window')
    expect(texts.some((t) => t.includes('Q-2026-014'))).toBe(true)
    expect(texts.some((t) => t.includes('Jane Doe'))).toBe(true)
    expect(texts).toContain('Total')
    // Manual line shown; installation is a client-facing extra.
    expect(texts).toContain('Installation')
  })

  it('excludes the internal cost breakdown by default (FR-3)', () => {
    const texts = allText(buildQuoteDocument(report(), baseOptions))
    // No overhead/margin/labor-hours lines, and no per-material subtotal, in the client view.
    expect(texts.some((t) => t.startsWith('Overhead'))).toBe(false)
    expect(texts.some((t) => t.startsWith('Margin'))).toBe(false)
    expect(texts).not.toContain('Materials subtotal')
    expect(texts.some((t) => t.startsWith('Labor subtotal'))).toBe(false)
  })

  it('includes the internal breakdown when toggled on (FR-3)', () => {
    const texts = allText(buildQuoteDocument(report(), { ...baseOptions, includeBreakdown: true }))
    expect(texts).toContain('Materials')
    expect(texts).toContain('Labor')
    expect(texts.some((t) => t.startsWith('Overhead'))).toBe(true)
    expect(texts.some((t) => t.startsWith('Margin'))).toBe(true)
    expect(texts.some((t) => t.startsWith('Labor subtotal'))).toBe(true)
  })

  it('places the panel image when supplied', () => {
    const doc = buildQuoteDocument(report(), {
      ...baseOptions,
      panelImage: { data: PNG_1x1, format: 'png', widthPx: 200, heightPx: 100 },
    })
    let imageOps = 0
    for (const page of doc.pages) forEachOp(page.ops, (op) => op.kind === 'image' && imageOps++)
    expect(imageOps).toBe(1)
  })

  it('renders to valid PDF bytes, including the embedded image', async () => {
    const doc = buildQuoteDocument(report(), {
      ...baseOptions,
      includeBreakdown: true,
      panelImage: { data: PNG_1x1, format: 'png', widthPx: 200, heightPx: 100 },
    })
    const bytes = await renderPdf(doc)
    // Valid PDF header.
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(1000)
  })

  it('flags unpriced glass with a note', () => {
    const bom: BomReport = {
      technique: 'lead',
      cutting: [],
      glass: [
        {
          glassId: 'gB',
          code: 'B',
          name: 'Ruby',
          count: 1,
          netAreaMm2: 1,
          buyAreaMm2: 1,
          cost: undefined,
          pieceIds: ['p1'],
        },
      ],
      came: [],
      foil: null,
      reinforcement: [],
      weight: { grams: 0, glassGrams: 0, leadGrams: 0 },
      factors: {
        glassWaste: 0.3,
        leadWaste: 0.1,
        solderGramsPerMetre: 20,
        foilRollLengthMm: 33_000,
      },
      pieceCount: 1,
    }
    const q = computeQuote({
      bom,
      currency: { code: 'EUR', symbol: '€' },
      priceBook: {
        leadPerMetre: 3.5,
        foilPerMetre: 1.2,
        solderPerKg: 28,
        reinforcementPerMetre: 6,
        consumables: [],
      },
      labor: {
        hourlyRate: 45,
        setupHours: 2,
        minutesPerPiece: 12,
        minutesPerSeamMetre: 15,
        minutesPerComplexity: 8,
        foilPieceFactor: 1.4,
      },
      overheadPct: 0.15,
      marginPct: 0.3,
      manualLines: [],
      pieces: [],
    })
    const texts = allText(buildQuoteDocument(q, baseOptions))
    expect(
      texts.some(
        (t) => t.toLowerCase().includes('no price set') || t.toLowerCase().includes('understate'),
      ),
    ).toBe(true)
  })
})
