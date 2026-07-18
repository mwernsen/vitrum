import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ViewportController } from '../canvas/viewport.svelte'
import { SnapController } from '../tools/snap.svelte'

import SnapSettings from './SnapSettings.svelte'

afterEach(() => {
  localStorage.clear()
})

function setup() {
  const viewport = new ViewportController()
  const snap = new SnapController(viewport)
  return { viewport, snap }
}

describe('SnapSettings', () => {
  it('opens the popover and lists every snap kind', async () => {
    const user = userEvent.setup()
    const { viewport, snap } = setup()
    render(SnapSettings, { snap, viewport })

    await user.click(screen.getByRole('button', { name: /Snapping on/ }))
    const dialog = screen.getByRole('dialog', { name: 'Snap settings' })
    expect(dialog).toBeInTheDocument()
    for (const label of ['Endpoint', 'Intersection', 'Midpoint', 'On curve', 'Grid', 'Angle']) {
      expect(screen.getByRole('switch', { name: label })).toBeInTheDocument()
    }
  })

  it('toggles a per-kind switch on the controller', async () => {
    const user = userEvent.setup()
    const { viewport, snap } = setup()
    render(SnapSettings, { snap, viewport })

    await user.click(screen.getByRole('button', { name: /Snapping/ }))
    expect(snap.toggles.midpoint).toBe(true)
    await user.click(screen.getByRole('switch', { name: 'Midpoint' }))
    expect(snap.toggles.midpoint).toBe(false)
  })

  it('toggles guide visibility and fires clear-all-guides', async () => {
    const user = userEvent.setup()
    const { viewport, snap } = setup()
    const onClearGuides = vi.fn()
    render(SnapSettings, { snap, viewport, onClearGuides })

    await user.click(screen.getByRole('button', { name: /Snapping/ }))
    await user.click(screen.getByRole('switch', { name: 'Show guides' }))
    expect(viewport.guidesVisible).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Clear all guides' }))
    expect(onClearGuides).toHaveBeenCalledOnce()
  })
})
