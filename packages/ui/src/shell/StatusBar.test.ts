import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'

import StatusBar from './StatusBar.svelte'

afterEach(() => {
  localStorage.clear()
})

describe('StatusBar', () => {
  it('shows placeholder coordinates before the pointer enters the canvas', () => {
    render(StatusBar, { viewport: new ViewportController() })
    expect(screen.getByLabelText('Cursor position')).toHaveTextContent('X — Y —')
  })

  it('reports the cursor position in the active unit', () => {
    const viewport = new ViewportController()
    viewport.resize(800, 600, 1)
    viewport.setCursor({ x: 100, y: 60 })
    render(StatusBar, { viewport })
    // Some finite millimetre reading, not the placeholder.
    expect(screen.getByLabelText('Cursor position')).not.toHaveTextContent('—')
    expect(screen.getByLabelText('Cursor position')).toHaveTextContent('mm')
  })

  it('shows the panel size in the active unit and switches unit', async () => {
    const user = userEvent.setup()
    const viewport = new ViewportController()
    render(StatusBar, { viewport, widthMm: 300, heightMm: 400 })

    expect(screen.getByLabelText('Panel dimensions')).toHaveTextContent('300.0 × 400.0 mm')

    await user.click(screen.getByRole('button', { name: /Measurement unit/ }))
    expect(viewport.unit).toBe('in')
    expect(screen.getByLabelText('Panel dimensions')).toHaveTextContent('11.81 × 15.75 in')
  })

  it('shows the active tool hint and toggles the bench-outputs drawer', async () => {
    const user = userEvent.setup()
    const onToggleDrawer = vi.fn()
    render(StatusBar, {
      viewport: new ViewportController(),
      hint: 'Click two points. Hold shift for 15° increments.',
      onToggleDrawer,
    })

    expect(screen.getByText(/Hold shift for 15°/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cutting list' }))
    expect(onToggleDrawer).toHaveBeenCalledOnce()
  })

  it('no longer owns grid, snapping or zoom — those moved to Draw and the viewport chip', () => {
    render(StatusBar, { viewport: new ViewportController() })
    // Cockpit v2: the status bar is a readout plus the two global switches. Grid and snapping live
    // in the Draw dock section; zoom, fit, 1:1 and calibrate on the canvas viewport chip.
    expect(screen.queryByRole('button', { name: /^Grid/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Snapping/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zoom to fit' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Zoom level')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Calibrate physical size' }),
    ).not.toBeInTheDocument()
  })
})
