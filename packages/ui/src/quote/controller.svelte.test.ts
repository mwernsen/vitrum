import { computeQuote, type BomReport } from '@vitrum/core'
import { describe, expect, it, vi } from 'vitest'

import { QuoteController } from './controller.svelte'

function report() {
  const bom: BomReport = {
    technique: 'lead',
    cutting: [],
    glass: [
      {
        glassId: 'gA',
        code: 'A',
        name: 'Clear',
        count: 1,
        netAreaMm2: 1,
        buyAreaMm2: 1,
        cost: 10,
        pieceIds: ['p1'],
      },
    ],
    came: [],
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
    manualLines: [],
    pieces: [],
  })
}

const options = {
  projectName: 'Sample',
  unit: 'mm' as const,
  client: { clientName: '', projectTitle: 'Rose', quoteNumber: 'Q-1', notes: '' },
  date: '2026-07-22',
}

describe('QuoteController (F-056)', () => {
  it('defaults: breakdown off (FR-3), panel image on', () => {
    const quote = new QuoteController()
    expect(quote.includeBreakdown).toBe(false)
    expect(quote.includePanelImage).toBe(true)
    expect(quote.smallestN).toBe(12)
  })

  it('exports a PDF through the host, returning the saved path', async () => {
    const quote = new QuoteController()
    const savePdf = vi.fn(async (name: string, bytes: Uint8Array) => {
      expect(name).toBe('Rose-quote.pdf')
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
      return '/tmp/Rose-quote.pdf'
    })
    const path = await quote.exportPdf(report(), options, savePdf)
    expect(path).toBe('/tmp/Rose-quote.pdf')
    expect(quote.exporting).toBe(false)
    expect(quote.errorMessage).toBeNull()
  })

  it('captures a save error instead of throwing', async () => {
    const quote = new QuoteController()
    const savePdf = vi.fn(async () => {
      throw new Error('disk full')
    })
    const path = await quote.exportPdf(report(), options, savePdf)
    expect(path).toBeNull()
    expect(quote.errorMessage).toBe('disk full')
    expect(quote.exporting).toBe(false)
  })
})
