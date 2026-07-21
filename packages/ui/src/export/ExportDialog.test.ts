import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import { ExportController } from './controller.svelte'
import ExportDialog from './ExportDialog.svelte'

function props(overrides: Partial<Parameters<typeof ExportDialog>[1]> = {}) {
  const controller = new ExportController()
  controller.open = true
  return {
    controller,
    canExport: true,
    drcErrorCount: 0,
    checksRun: true,
    onExport: vi.fn(),
    ...overrides,
  }
}

describe('ExportDialog (F-043)', () => {
  it('shows format-specific options for SVG and hides the numbers toggle for linework', () => {
    render(ExportDialog, props())
    expect(screen.getByText(/1 mm in the file is 1 mm/)).toBeInTheDocument()
    // Linework is pure geometry — no piece-numbers toggle.
    expect(screen.queryByText('Include piece numbers')).not.toBeInTheDocument()
  })

  it('reveals the cut layout selector for the cut flavour', async () => {
    const p = props()
    p.controller.svgFlavor = 'cut'
    render(ExportDialog, p)
    expect(screen.getByText(/one closed path per piece/)).toBeInTheDocument()
    expect(screen.getByText('Include piece numbers')).toBeInTheDocument()
  })

  it('shows the DXF layer note when DXF is selected', () => {
    const p = props()
    p.controller.format = 'dxf'
    render(ExportDialog, p)
    expect(screen.getByText(/LEAD, BORDER, CUT/)).toBeInTheDocument()
  })

  it('warns about DRC errors but keeps export enabled (policy: warn)', () => {
    render(ExportDialog, props({ drcErrorCount: 3 }))
    expect(screen.getByRole('alert')).toHaveTextContent(/3 outstanding design rule errors/)
    expect(screen.getByRole('button', { name: 'Export' })).toBeEnabled()
  })

  it('disables export when there is nothing to export', () => {
    render(ExportDialog, props({ canExport: false }))
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })

  it('fires onExport on click', async () => {
    const p = props()
    render(ExportDialog, p)
    await fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(p.onExport).toHaveBeenCalledOnce()
  })
})
