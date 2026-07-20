import { vec2, type BBox } from '@vitrum/geometry'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import { PrintController } from './controller.svelte'
import PrintDialog from './PrintDialog.svelte'

const BOUNDS: BBox = { min: vec2(0, 0), max: vec2(600, 800) }

function props(overrides: Partial<Parameters<typeof PrintDialog>[1]> = {}) {
  const controller = new PrintController()
  controller.open = true
  return {
    controller,
    bounds: BOUNDS,
    pieceCount: 3,
    drcErrorCount: 0,
    checksRun: true,
    onExport: vi.fn(),
    ...overrides,
  }
}

describe('PrintDialog (F-041)', () => {
  it('shows the tile-count summary and calibration warning', () => {
    render(PrintDialog, props())
    expect(screen.getByText(/tiles/)).toBeInTheDocument()
    expect(screen.getByText(/pages/)).toBeInTheDocument()
    expect(screen.getByText(/100 mm calibration ruler/)).toBeInTheDocument()
  })

  it('warns about outstanding DRC errors but still allows export', () => {
    const p = props({ drcErrorCount: 2 })
    render(PrintDialog, p)
    expect(screen.getByRole('alert')).toHaveTextContent(/2 outstanding design rule errors/)
    const button = screen.getByRole('button', { name: 'Export PDF' })
    expect(button).toBeEnabled()
  })

  it('fires onExport when the export button is clicked', async () => {
    const p = props()
    render(PrintDialog, p)
    await fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
    expect(p.onExport).toHaveBeenCalledOnce()
  })

  it('disables export when there are no pieces', () => {
    render(PrintDialog, props({ pieceCount: 0 }))
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled()
  })

  it('warns and disables export when margins leave no printable area', () => {
    const p = props()
    p.controller.marginMm = 200
    render(PrintDialog, p)
    expect(screen.getByText(/no printable area/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled()
  })
})
