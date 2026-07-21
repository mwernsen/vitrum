import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import { ImportController } from './controller.svelte'
import ImportDialog from './ImportDialog.svelte'

/** A square with 1 mm gaps at every corner plus a text element that must be reported dropped. */
const MESSY_SQUARE =
  '<svg viewBox="0 0 100 100">' +
  '<text x="0" y="0">label</text>' +
  '<path d="M0 0 L100 0"/>' +
  '<path d="M100 1 L100 100"/>' +
  '<path d="M99 100 L0 100"/>' +
  '<path d="M0 99 L0 1"/>' +
  '</svg>'

/** An unambiguous file (real mm units) with a clean closed rectangle. */
const CLEAN_MM =
  '<svg width="100mm" height="100mm" viewBox="0 0 100 100">' +
  '<rect x="10" y="10" width="80" height="80"/></svg>'

async function open(svg: string): Promise<ImportController> {
  const controller = new ImportController()
  await controller.load(async () => ({ path: 'drawing.svg', contents: svg }))
  return controller
}

describe('ImportDialog (F-050)', () => {
  it('shows the file name, a live piece count and the healing controls', async () => {
    const controller = await open(CLEAN_MM)
    render(ImportDialog, { controller, onImport: vi.fn() })
    expect(screen.getByText('drawing.svg')).toBeInTheDocument()
    expect(screen.getByText(/Pieces detected:/)).toBeInTheDocument()
    expect(screen.getByLabelText('Healing tolerance')).toBeInTheDocument()
    // A clean closed rectangle already reads as one piece at tolerance 0.
    expect(controller.preview?.pieceCount).toBe(1)
  })

  it('reports dropped unsupported content (FR-5)', async () => {
    const controller = await open(MESSY_SQUARE)
    render(ImportDialog, { controller, onImport: vi.fn() })
    expect(screen.getByText(/Unsupported content was dropped/)).toBeInTheDocument()
    expect(screen.getByText(/text/)).toBeInTheDocument()
  })

  it('healing the messy square raises the detected piece count as tolerance grows', async () => {
    const controller = await open(MESSY_SQUARE)
    expect(controller.preview?.pieceCount).toBe(0) // raw 1 mm gaps close nothing

    controller.setTolerance(1.5)
    await waitFor(() => expect(controller.toleranceMm).toBe(1.5))
    expect(controller.preview?.pieceCount).toBe(1)
  })

  it('offers a scale field only for an ambiguous-unit file', async () => {
    const ambiguous = await open(MESSY_SQUARE) // viewBox only, no real units
    expect(ambiguous.ambiguous).toBe(true)
    render(ImportDialog, { controller: ambiguous, onImport: vi.fn() })
    expect(screen.getByLabelText('Artwork width (mm)')).toBeInTheDocument()
  })

  it('hides the scale field for an unambiguous real-unit file', async () => {
    const clean = await open(CLEAN_MM)
    expect(clean.ambiguous).toBe(false)
    render(ImportDialog, { controller: clean, onImport: vi.fn() })
    expect(screen.queryByLabelText('Artwork width (mm)')).not.toBeInTheDocument()
  })

  it('confirms import through the callback and can be cancelled', async () => {
    const controller = await open(CLEAN_MM)
    const onImport = vi.fn()
    render(ImportDialog, { controller, onImport })
    await fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(onImport).toHaveBeenCalledOnce()
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(controller.open).toBe(false)
  })
})
