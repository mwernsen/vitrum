import type { BomReport } from '@vitrum/core'
import type { BomSettings } from '@vitrum/model'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import BomPanel from './BomPanel.svelte'

const factors: BomSettings = {
  glassWaste: 0.3,
  leadWaste: 0.1,
  solderGramsPerMetre: 20,
  foilRollLengthMm: 33_000,
}

function report(over: Partial<BomReport> = {}): BomReport {
  return {
    technique: 'lead',
    cutting: [
      {
        glassId: 'g1',
        code: 'A',
        name: 'Ruby',
        color: '#c0392b',
        manufacturer: 'Aurora',
        rows: [
          {
            contentId: 'kA1',
            pieceId: 'pA1',
            label: 'A1',
            widthMm: 98.1,
            heightMm: 98.1,
            areaMm2: 9623.61,
            degenerate: false,
          },
          {
            contentId: 'kA2',
            pieceId: 'pA2',
            label: 'A2',
            widthMm: 60,
            heightMm: 40,
            areaMm2: 2400,
            degenerate: false,
          },
        ],
        count: 2,
        netAreaMm2: 12023.61,
        buyAreaMm2: 15630.693,
        pieceIds: ['pA1', 'pA2'],
      },
    ],
    glass: [
      {
        glassId: 'g1',
        code: 'A',
        name: 'Ruby',
        color: '#c0392b',
        manufacturer: 'Aurora',
        count: 2,
        netAreaMm2: 12023.61,
        buyAreaMm2: 15630.693,
        sheet: { widthMm: 600, heightMm: 600, sheetsNeeded: 1 },
        cost: 1.56,
        pieceIds: ['pA1', 'pA2'],
      },
    ],
    came: [
      {
        profileId: 'p5',
        name: 'H 5 mm',
        kind: 'H',
        flangeMm: 5,
        heartMm: 1.5,
        netLengthMm: 700,
        buyLengthMm: 770,
        segmentIds: ['s1', 's2'],
      },
    ],
    foil: null,
    reinforcement: [],
    weight: { grams: 1420, glassGrams: 1200, leadGrams: 220 },
    factors,
    pieceCount: 2,
    ...over,
  }
}

function base(over: Record<string, unknown> = {}) {
  return {
    report: report(),
    unit: 'mm' as const,
    sort: 'number' as const,
    onSort: vi.fn(),
    factors,
    onSetFactor: vi.fn(),
    onHighlight: vi.fn(),
    onClearHighlight: vi.fn(),
    onExportPdf: vi.fn(),
    onExportCsv: vi.fn(),
    ...over,
  }
}

describe('BomPanel (F-042)', () => {
  it('renders the cutting list per glass with number, dims and area', () => {
    render(BomPanel, base())
    // "Ruby" appears in both the cutting list and the glass BOM.
    expect(screen.getAllByText('Ruby').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('A1')).toBeInTheDocument()
    // Dimensions shown in mm (FR-4).
    expect(screen.getByText('98.1 mm × 98.1 mm')).toBeInTheDocument()
  })

  it('shows the empty-state prompt when there are no pieces', () => {
    render(BomPanel, base({ report: report({ pieceCount: 0, cutting: [], glass: [] }) }))
    expect(screen.getByText(/Draw a design and assign glass/)).toBeInTheDocument()
  })

  it('highlights a glass section on hover (traceability)', async () => {
    const onHighlight = vi.fn()
    const { container } = render(BomPanel, base({ onHighlight }))
    const group = container.querySelector('.glass-group')!
    await fireEvent.mouseEnter(group)
    expect(onHighlight).toHaveBeenCalledWith(['pA1', 'pA2'])
  })

  it('highlights a came profile segments on hover', async () => {
    const onHighlight = vi.fn()
    render(BomPanel, base({ onHighlight }))
    const cameLine = screen.getByText('H 5 mm').closest('button')!
    await fireEvent.mouseEnter(cameLine)
    expect(onHighlight).toHaveBeenCalledWith([], ['s1', 's2'])
  })

  it('switches the cutting-list sort', async () => {
    const onSort = vi.fn()
    render(BomPanel, base({ onSort }))
    await fireEvent.click(screen.getByRole('button', { name: 'Size' }))
    expect(onSort).toHaveBeenCalledWith('size')
  })

  it('shows the foil/solder BOM section in foil technique', () => {
    render(
      BomPanel,
      base({
        report: report({
          technique: 'foil',
          came: [],
          foil: {
            netSeamLengthMm: 700,
            buySeamLengthMm: 770,
            rollLengthMm: 33_000,
            rollsNeeded: 1,
            solderGramsPerMetre: 20,
            solderGrams: 14,
            segmentIds: ['s1'],
          },
        }),
      }),
    )
    expect(screen.getByText('Copper foil')).toBeInTheDocument()
    expect(screen.getByText('Solder')).toBeInTheDocument()
    expect(screen.getByText(/20 g\/m/)).toBeInTheDocument()
  })

  it('edits a waste factor through the settings disclosure', async () => {
    const onSetFactor = vi.fn()
    render(BomPanel, base({ onSetFactor }))
    await fireEvent.click(screen.getByRole('button', { name: /Estimation settings/ }))
    const input = screen.getByLabelText('Glass waste (%)')
    await fireEvent.input(input, { target: { value: '50' } })
    expect(onSetFactor).toHaveBeenCalledWith({ glassWaste: 0.5 })
  })

  it('runs the PDF and CSV exports', async () => {
    const onExportPdf = vi.fn()
    const onExportCsv = vi.fn()
    render(BomPanel, base({ onExportPdf, onExportCsv }))
    await fireEvent.click(screen.getByRole('button', { name: 'PDF…' }))
    await fireEvent.click(screen.getByRole('button', { name: 'CSV…' }))
    expect(onExportPdf).toHaveBeenCalled()
    expect(onExportCsv).toHaveBeenCalled()
  })

  it('disables export when no pieces', () => {
    render(BomPanel, base({ report: report({ pieceCount: 0, cutting: [], glass: [] }) }))
    expect(screen.getByRole('button', { name: 'PDF…' })).toBeDisabled()
  })
})
