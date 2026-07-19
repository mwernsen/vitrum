import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'

import StatusBar from './StatusBar.svelte'

afterEach(() => {
  localStorage.clear()
})

describe('StatusBar', () => {
  it('shows placeholder coordinates and 1:1 zoom by default', () => {
    render(StatusBar, { viewport: new ViewportController() })
    expect(screen.getByLabelText('Cursor position')).toHaveTextContent('X — Y —')
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%')
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

  it('toggles unit and grid, and fires fit/calibrate callbacks', async () => {
    const user = userEvent.setup()
    const viewport = new ViewportController()
    const onfit = vi.fn()
    const oncalibrate = vi.fn()
    render(StatusBar, { viewport, onfit, oncalibrate })

    await user.click(screen.getByRole('button', { name: /Measurement unit/ }))
    expect(viewport.unit).toBe('in')

    await user.click(screen.getByRole('button', { name: /Grid/ }))
    expect(viewport.gridVisible).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Zoom to fit' }))
    expect(onfit).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Calibrate physical size' }))
    expect(oncalibrate).toHaveBeenCalledOnce()
  })

  it('no longer owns the overlay toggles — those moved to the Layers panel (turn-3 IA)', () => {
    render(StatusBar, { viewport: new ViewportController() })
    // Glass / Pieces / Cuts visibility and the unassigned counter live in the Layers dock and
    // the readiness strip now; the status bar keeps only cursor · grid/snap · zoom · units.
    expect(screen.queryByRole('button', { name: /Glass/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Piece overlay/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cut-contour/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('unassigned-count')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Grid/ })).toBeInTheDocument()
  })
})
