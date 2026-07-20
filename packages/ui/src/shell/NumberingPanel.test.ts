import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

import NumberingPanel, { type LegendEntry } from './NumberingPanel.svelte'

const legend: LegendEntry[] = [
  { glassId: 'g1', code: 'A', name: 'Cobalt blue', manufacturer: 'Spectrum', count: 3 },
  { glassId: 'g2', code: 'B', name: 'Amber', count: 1 },
]

function base(overrides: Partial<Parameters<typeof NumberingPanel>[1]> = {}) {
  return {
    scheme: 'grouped' as const,
    onScheme: vi.fn(),
    onRenumber: vi.fn(),
    onSetCode: vi.fn(),
    pieceCount: 4,
    unnumbered: 1,
    legend,
    ...overrides,
  }
}

describe('NumberingPanel (F-040)', () => {
  it('shows the numbered ratio and unnumbered count', () => {
    render(NumberingPanel, base())
    expect(screen.getByText('3 / 4')).toBeInTheDocument()
    expect(screen.getByText('Unnumbered')).toBeInTheDocument()
  })

  it('renders one legend row per glass in use (FR-4)', () => {
    render(NumberingPanel, base())
    expect(screen.getByText('Cobalt blue')).toBeInTheDocument()
    expect(screen.getByText('Amber')).toBeInTheDocument()
    expect(screen.getByText('Spectrum')).toBeInTheDocument()
  })

  it('renumbers on click', async () => {
    const props = base()
    render(NumberingPanel, props)
    await fireEvent.click(screen.getByRole('button', { name: 'Renumber' }))
    expect(props.onRenumber).toHaveBeenCalledOnce()
  })

  it('disables renumber when there are no pieces', () => {
    render(NumberingPanel, base({ pieceCount: 0, unnumbered: 0, legend: [] }))
    expect(screen.getByRole('button', { name: 'Renumber' })).toBeDisabled()
  })

  it('prompts to assign glass when the legend is empty', () => {
    render(NumberingPanel, base({ legend: [] }))
    expect(screen.getByText(/Assign glass to pieces/)).toBeInTheDocument()
  })

  it('changes scheme via the selector', async () => {
    const props = base()
    render(NumberingPanel, props)
    await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sequential' } })
    expect(props.onScheme).toHaveBeenCalledWith('sequential')
  })

  it('shows a live print action when wired, opening the dialog on click (F-041)', async () => {
    const onPrint = vi.fn()
    render(NumberingPanel, base({ onPrint, printAvailable: true }))
    const button = screen.getByRole('button', { name: /Print cartoon 1:1/ })
    expect(button).toBeEnabled()
    await fireEvent.click(button)
    expect(onPrint).toHaveBeenCalledOnce()
  })

  it('disables the print action when nothing is printable', () => {
    render(NumberingPanel, base({ onPrint: vi.fn(), printAvailable: false }))
    expect(screen.getByRole('button', { name: /Print cartoon 1:1/ })).toBeDisabled()
  })

  it('falls back to a print placeholder when no host export is available', () => {
    render(NumberingPanel, base())
    expect(screen.getByText('Print cartoon 1:1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Print cartoon 1:1/ })).toBeNull()
  })
})
