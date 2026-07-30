import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import ReadinessMeter from './ReadinessMeter.svelte'

/** Open the meter's popover, where the four readiness steps live. */
async function open(props: Record<string, unknown>) {
  const user = userEvent.setup()
  render(ReadinessMeter, props)
  await user.click(screen.getByTestId('readiness-meter'))
  return user
}

describe('ReadinessMeter — the collapsed strip (F-020/023/030/040)', () => {
  it('counts the cleared steps on the trigger', () => {
    // Geometry closes and every piece is painted; checks have not run and nothing is numbered.
    render(ReadinessMeter, { pieceCount: 4, unassignedCount: 0, unnumberedCount: 4 })
    expect(screen.getByTestId('readiness-meter')).toHaveTextContent('2 / 4')
  })

  it('counts all four once the panel is ready to cut', () => {
    render(ReadinessMeter, {
      pieceCount: 4,
      unassignedCount: 0,
      unnumberedCount: 0,
      checksRun: true,
    })
    expect(screen.getByTestId('readiness-meter')).toHaveTextContent('4 / 4')
  })

  it('reads "not run yet" before the first check', async () => {
    await open({ pieceCount: 2, checksRun: false })
    expect(screen.getByRole('dialog', { name: 'Ready to cut' })).toHaveTextContent('not run yet')
  })

  it('reads "clear" when a run finds nothing', async () => {
    await open({ pieceCount: 2, checksRun: true })
    expect(screen.getByText('Checks are clear').parentElement).toHaveTextContent('clear')
  })

  it('breaks the issue counts out by severity', async () => {
    await open({ pieceCount: 3, checksRun: true, errorCount: 2, warningCount: 1 })
    expect(screen.getByText('Checks are clear').parentElement).toHaveTextContent(
      '2 errors · 1 warnings',
    )
  })

  it('shows the painted and numbered ratios', async () => {
    await open({ pieceCount: 4, unassignedCount: 1, unnumberedCount: 2 })
    expect(screen.getByText('Every piece has glass').parentElement).toHaveTextContent(
      '3 of 4 painted',
    )
    expect(screen.getByText('Pieces are numbered').parentElement).toHaveTextContent(
      '2 of 4 numbered',
    )
  })

  it('dashes the per-piece steps before any piece exists', async () => {
    await open({ pieceCount: 0 })
    expect(screen.getByText('Geometry closes').parentElement).toHaveTextContent(
      'no closed pieces yet',
    )
    expect(screen.getByText('Pieces are numbered').parentElement).toHaveTextContent('—')
  })

  it('jumps to the dock section that clears a step, and closes', async () => {
    const onGoTo = vi.fn()
    const user = await open({ pieceCount: 4, unnumberedCount: 4, onGoTo })

    await user.click(screen.getByText('Pieces are numbered'))
    expect(onGoTo).toHaveBeenCalledWith('make')
    expect(screen.queryByRole('dialog', { name: 'Ready to cut' })).not.toBeInTheDocument()
  })

  it('labels each row action by what it would do', async () => {
    await open({ pieceCount: 4, unassignedCount: 2, checksRun: true, errorCount: 1 })
    expect(screen.getByText('Paint')).toBeInTheDocument()
    expect(screen.getByText('Fix')).toBeInTheDocument()
  })
})
