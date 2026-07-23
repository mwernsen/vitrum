import { vec2, type BBox } from '@vitrum/geometry'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import { BomController } from '../bom/controller.svelte'
import { PrintController } from '../print/controller.svelte'
import { QuoteController } from '../quote/controller.svelte'

import { ExportController } from './controller.svelte'
import ExportDialog from './ExportDialog.svelte'

const BOUNDS: BBox = { min: vec2(0, 0), max: vec2(600, 800) }

function props(overrides: Partial<Parameters<typeof ExportDialog>[1]> = {}) {
  const controller = new ExportController()
  controller.open = true
  return {
    controller,
    print: new PrintController(),
    bom: new BomController(),
    quote: new QuoteController(),
    bounds: BOUNDS,
    pieceCount: 3,
    hasBom: true,
    hasQuote: true,
    drcErrorCount: 0,
    checksRun: true,
    onExport: vi.fn(),
    ...overrides,
  }
}

describe('ExportDialog (F-043, consolidated)', () => {
  it('defaults to the design sheet type with scale/look options', () => {
    render(ExportDialog, props())
    expect(screen.getByText(/single sheet holding the whole design/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })

  it('switches to design files and reveals SVG flavour + hides numbers for linework', async () => {
    const p = props()
    p.controller.docType = 'design-files'
    render(ExportDialog, p)
    expect(screen.getByText(/1 mm in the file is 1 mm/)).toBeInTheDocument()
    // Linework is pure geometry — no piece-numbers toggle.
    expect(screen.queryByText('Include piece numbers')).not.toBeInTheDocument()
  })

  it('shows the cut note + numbers toggle for the cut flavour', () => {
    const p = props()
    p.controller.docType = 'design-files'
    p.controller.svgFlavor = 'cut'
    render(ExportDialog, p)
    expect(screen.getByText(/one closed path per piece/)).toBeInTheDocument()
    expect(screen.getByText('Include piece numbers')).toBeInTheDocument()
  })

  it('shows the tiled 1:1 template options + tile-count summary', () => {
    const p = props()
    p.controller.docType = 'tiled'
    render(ExportDialog, p)
    expect(screen.getByText(/tiles/)).toBeInTheDocument()
    expect(screen.getByText(/pages/)).toBeInTheDocument()
    expect(screen.getByText(/100 mm calibration ruler/)).toBeInTheDocument()
    expect(screen.getByText('Alignment marks')).toBeInTheDocument()
  })

  it('warns and disables export when tiled margins leave no printable area', () => {
    const p = props()
    p.controller.docType = 'tiled'
    p.print.marginMm = 2000
    render(ExportDialog, p)
    expect(screen.getByText(/no printable area/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })

  it('offers PDF/CSV for the cutting list, disabled when no BOM', () => {
    const p = props({ hasBom: false })
    p.controller.docType = 'bom'
    render(ExportDialog, p)
    expect(screen.getByText(/cutting list and bill of materials/)).toBeInTheDocument()
    expect(screen.getByText(/Assign glass to pieces/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })

  it('describes the PNG snapshot type', () => {
    const p = props()
    p.controller.docType = 'png'
    render(ExportDialog, p)
    expect(screen.getByText(/PNG raster snapshot/)).toBeInTheDocument()
  })

  it('warns about DRC errors but keeps export enabled (policy: warn)', () => {
    render(ExportDialog, props({ drcErrorCount: 3 }))
    expect(screen.getByRole('alert')).toHaveTextContent(/3 outstanding design rule errors/)
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })

  it('disables export when there are no pieces', () => {
    render(ExportDialog, props({ pieceCount: 0 }))
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })

  it('fires onExport on click', async () => {
    const p = props()
    render(ExportDialog, p)
    await fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(p.onExport).toHaveBeenCalledOnce()
  })
})
