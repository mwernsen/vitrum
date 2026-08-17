import type { Panel } from '@vitrum/core'
import { render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import AppShell from './AppShell.svelte'

const panel: Panel = {
  id: 'p',
  name: 'Rose window',
  widthMm: 500,
  heightMm: 500,
  pieces: [
    {
      id: 'a',
      label: 'Petal',
      color: '#dc2626',
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    },
  ],
}

describe('AppShell', () => {
  it('renders every cockpit region plus the canvas', () => {
    render(AppShell, { panel })
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Workspace sections' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Panel dock' })).toBeInTheDocument()
    expect(screen.getByRole('main', { name: 'Design canvas' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Status bar' })).toBeInTheDocument()
  })

  it('opens on the Draw section, so the tool palette is the first thing to hand', () => {
    render(AppShell, { panel })
    expect(screen.getByRole('toolbar', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Draw' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows panel size in millimetres by default and toggles to inches', async () => {
    const user = userEvent.setup()
    render(AppShell, { panel })

    expect(screen.getByLabelText('Panel dimensions')).toHaveTextContent('500.0 × 500.0 mm')

    await user.click(screen.getByRole('button', { name: /Measurement unit/ }))

    expect(screen.getByLabelText('Panel dimensions')).toHaveTextContent('19.69 × 19.69 in')
  })

  it('collapses readiness into one top-bar meter, not a 44px strip', () => {
    render(AppShell, { panel })
    expect(screen.getByTestId('readiness-meter')).toBeInTheDocument()
    expect(screen.queryByLabelText('Panel readiness')).not.toBeInTheDocument()
  })

  it('switches the dock from the activity rail', async () => {
    const user = userEvent.setup()
    render(AppShell, { panel })

    await user.click(screen.getByRole('button', { name: 'Check' }))
    expect(screen.getByRole('button', { name: 'Check' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('toolbar', { name: 'Tools' })).not.toBeInTheDocument()
  })

  it('opens the bench-outputs drawer from the status bar', async () => {
    const user = userEvent.setup()
    render(AppShell, { panel })

    expect(screen.queryByRole('region', { name: 'Bench outputs' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cutting list' }))
    expect(screen.getByRole('region', { name: 'Bench outputs' })).toBeInTheDocument()
  })

  // Run 2026-08-16-b: the render view is *about* per-piece appearance (F-053 texture placement), but
  // reaching it meant opening the Draw dock and arming "Select pieces" — which nobody thinks to do in
  // a view about how glass looks. Entering render arms it; an explicit choice always wins.
  describe('render view arms the piece selector', () => {
    const tools = () => screen.getByRole('toolbar', { name: 'Tools' })
    const pressedTool = () =>
      within(tools())
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.getAttribute('aria-label'))

    it('arms piece-select on entering render and puts it back on leaving', async () => {
      const user = userEvent.setup()
      render(AppShell, { panel })
      expect(pressedTool()).toEqual(['Select (Esc)'])

      await user.click(screen.getByRole('tab', { name: 'Render' }))
      expect(pressedTool()).toEqual(['Select pieces'])

      await user.click(screen.getByRole('tab', { name: 'Design' }))
      expect(pressedTool()).toEqual(['Select (Esc)'])
    })

    it('lets a drawing tool picked in render win, and keeps it on the way out', async () => {
      const user = userEvent.setup()
      render(AppShell, { panel })
      await user.click(screen.getByRole('tab', { name: 'Render' }))

      // The Draw dock stays open and usable in render; picking from it is a deliberate choice.
      await user.click(within(tools()).getByRole('button', { name: 'Line (L)' }))
      expect(pressedTool()).toEqual(['Line (L)'])

      await user.click(screen.getByRole('tab', { name: 'Design' }))
      expect(pressedTool()).toEqual(['Line (L)'])
    })

    it('does not stamp render "read-only" — glass and textures are edited in it', async () => {
      const user = userEvent.setup()
      render(AppShell, { panel })

      await user.click(screen.getByRole('tab', { name: 'Cartoon' }))
      expect(screen.getByRole('status')).toHaveTextContent('read-only')

      await user.click(screen.getByRole('tab', { name: 'Render' }))
      expect(screen.getByRole('status')).toHaveTextContent('Render — glass as it will look')
      expect(screen.getByRole('status')).not.toHaveTextContent('read-only')
    })
  })
})
