import { computeQuote, type BomReport, type QuoteReport } from '@vitrum/core'
import { defaultQuoteSettings, type QuoteSettings } from '@vitrum/model'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import QuotePanel from './QuotePanel.svelte'

function bom(over: Partial<BomReport> = {}): BomReport {
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
    pieceCount: 2,
    ...over,
  }
}

function report(): QuoteReport {
  return computeQuote({
    bom: bom(),
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
      {
        contentId: 'c2',
        pieceId: 'p2',
        label: 'B1',
        glassId: 'gB',
        areaMm2: 1600,
        perimeterMm: 200,
        bboxWidthMm: 40,
        bboxHeightMm: 40,
      },
    ],
  })
}

function props(over: Partial<Parameters<typeof QuotePanel>[1]> = {}) {
  return {
    report: report(),
    settings: defaultQuoteSettings(),
    onPatch: vi.fn(),
    smallestN: 12,
    onSmallestN: vi.fn(),
    onHighlight: vi.fn(),
    onClearHighlight: vi.fn(),
    ...over,
  }
}

describe('QuotePanel (F-056)', () => {
  it('shows the total and the overhead/margin lines', () => {
    const r = report()
    render(QuotePanel, props({ report: r }))
    expect(screen.getByText('Total')).toBeInTheDocument()
    const total = `€${r.total.toFixed(2)}`
    expect(screen.getByText(total)).toBeInTheDocument()
    expect(screen.getByText(/Overhead \(15%\)/)).toBeInTheDocument()
    expect(screen.getByText(/Margin \(30%\)/)).toBeInTheDocument()
  })

  it('shows the empty state until pieces exist', () => {
    render(QuotePanel, props({ report: null }))
    expect(screen.getByText(/Draw a design and assign glass/)).toBeInTheDocument()
  })

  it('highlights the smallest pieces on hover (sensitivity, FR-6)', async () => {
    const onHighlight = vi.fn()
    render(QuotePanel, props({ onHighlight }))
    const group = screen.getByText(/smallest pieces contribute/).closest('.sensitivity')!
    await fireEvent.mouseEnter(group)
    // p2 is the smaller piece → highlighted first.
    expect(onHighlight).toHaveBeenCalled()
    const ids = onHighlight.mock.calls[0]![0] as string[]
    expect(ids).toContain('p2')
  })

  it('patches the margin factor as one edit (FR-2)', async () => {
    const onPatch = vi.fn()
    render(QuotePanel, props({ onPatch }))
    const input = screen.getByLabelText('Margin — markup (%)') as HTMLInputElement
    await fireEvent.input(input, { target: { value: '40' } })
    expect(onPatch).toHaveBeenCalledWith({ marginPct: 0.4 })
  })

  it('edits a nested labor coefficient through a whole-object patch', async () => {
    const onPatch = vi.fn()
    render(QuotePanel, props({ onPatch }))
    await fireEvent.click(screen.getByText('Labor model'))
    const rate = screen.getByLabelText('Hourly rate (€/h)') as HTMLInputElement
    await fireEvent.input(rate, { target: { value: '60' } })
    expect(onPatch).toHaveBeenCalledTimes(1)
    const patch = onPatch.mock.calls[0]![0] as Partial<QuoteSettings>
    expect(patch.labor?.hourlyRate).toBe(60)
    // Sibling labor fields carried through.
    expect(patch.labor?.minutesPerPiece).toBe(12)
  })

  it('adds a manual line item', async () => {
    const onPatch = vi.fn()
    render(QuotePanel, props({ onPatch }))
    await fireEvent.click(screen.getByText('Add line item'))
    const patch = onPatch.mock.calls[0]![0] as Partial<QuoteSettings>
    expect(patch.manualLines).toHaveLength(1)
  })

  it('flags unpriced glass', () => {
    const r = computeQuote({
      bom: bom({
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
      }),
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
    render(QuotePanel, props({ report: r }))
    expect(screen.getByText(/no price/i)).toBeInTheDocument()
  })

  it('offers the workshop-default actions when the port is available', async () => {
    render(QuotePanel, props({ onSaveWorkshopDefault: vi.fn(), onLoadWorkshopDefault: vi.fn() }))
    await fireEvent.click(screen.getByText('Price book'))
    expect(screen.getByText('Save as workshop default')).toBeInTheDocument()
    expect(screen.getByText('Load workshop default')).toBeInTheDocument()
  })
})
