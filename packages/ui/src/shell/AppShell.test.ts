import type { Panel } from '@vitrum/core'
import { render, screen } from '@testing-library/svelte'
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
  it('renders all four regions plus the canvas', () => {
    render(AppShell, { panel })
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('toolbar')).toBeInTheDocument()
    expect(screen.getByRole('main', { name: 'Design canvas' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Status bar' })).toBeInTheDocument()
  })

  it('shows panel size in millimetres by default and toggles to inches', async () => {
    const user = userEvent.setup()
    render(AppShell, { panel })

    expect(screen.getByText('500.0 mm × 500.0 mm')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Measurement unit/ }))

    expect(screen.getByText('19.69 in × 19.69 in')).toBeInTheDocument()
  })
})
