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

  it('toggles the glass render and reports the unassigned-piece count (F-023)', async () => {
    const user = userEvent.setup()
    const viewport = new ViewportController()
    render(StatusBar, { viewport, unassignedCount: 3 })

    expect(screen.getByTestId('unassigned-count')).toHaveTextContent('Unassigned: 3')

    expect(viewport.glassVisible).toBe(true)
    await user.click(screen.getByRole('button', { name: /Glass/ }))
    expect(viewport.glassVisible).toBe(false)
  })
})
