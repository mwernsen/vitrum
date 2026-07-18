import { createEmptyProject, defaultTechnique, type Command } from '@vitrum/model'
import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import TechniquePanel from './TechniquePanel.svelte'

describe('TechniquePanel (F-021)', () => {
  it('shows the lead came library and default came selector', () => {
    render(TechniquePanel, { technique: defaultTechnique(), execute: () => {} })
    expect(screen.getByRole('heading', { name: 'Technique' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Came library' })).toBeInTheDocument()
    expect(screen.getByLabelText('Default came')).toBeInTheDocument()
    // The seed library is listed (one flange input per came profile).
    expect(screen.getAllByLabelText('Flange').length).toBe(
      Object.keys(defaultTechnique().lead.profiles).length,
    )
  })

  it('dispatches a technique switch when the foil tab is chosen', async () => {
    const execute = vi.fn<(command: Command) => void>()
    render(TechniquePanel, { technique: defaultTechnique(), execute })
    await fireEvent.click(screen.getByRole('tab', { name: 'Copper foil' }))
    expect(execute).toHaveBeenCalledTimes(1)
    const applied = execute.mock.calls[0]![0].apply(createEmptyProject())
    expect(applied.technique.kind).toBe('foil')
  })

  it('shows foil parameters with the fractional-inch equivalent', () => {
    render(TechniquePanel, {
      technique: { ...defaultTechnique(), kind: 'foil' },
      execute: () => {},
    })
    expect(screen.getByLabelText('Foil width (mm)')).toBeInTheDocument()
    expect(screen.getByLabelText('Solder finish')).toBeInTheDocument()
    // 5.6 mm ≈ 7/32"
    expect(screen.getByText(/7\/32/)).toBeInTheDocument()
  })

  it('adds a came profile via the command sink', async () => {
    const execute = vi.fn<(command: Command) => void>()
    render(TechniquePanel, { technique: defaultTechnique(), execute })
    await fireEvent.click(screen.getByRole('button', { name: 'Add came' }))
    expect(execute).toHaveBeenCalledTimes(1)
    const next = execute.mock.calls[0]![0].apply(createEmptyProject())
    expect(Object.keys(next.technique.lead.profiles).length).toBe(
      Object.keys(defaultTechnique().lead.profiles).length + 1,
    )
  })
})
