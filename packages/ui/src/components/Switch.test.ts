import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Switch from './Switch.svelte'

describe('Switch', () => {
  it('renders its label and exposes a switch-role checkbox', () => {
    render(Switch, { label: 'Show snap guides' })
    expect(screen.getByText('Show snap guides')).toBeInTheDocument()
    const input = screen.getByRole('switch')
    expect(input).toHaveAttribute('type', 'checkbox')
    expect(input).not.toBeChecked()
  })

  it('toggles and fires onchange with the new state', async () => {
    const onchange = vi.fn()
    render(Switch, { label: 'Show snap guides', onchange })
    const input = screen.getByRole('switch')

    await userEvent.click(input)
    expect(input).toBeChecked()
    expect(onchange).toHaveBeenLastCalledWith(true)

    await userEvent.click(input)
    expect(input).not.toBeChecked()
    expect(onchange).toHaveBeenLastCalledWith(false)
    expect(onchange).toHaveBeenCalledTimes(2)
  })

  it('does not fire onchange when disabled', async () => {
    const onchange = vi.fn()
    render(Switch, { label: 'Show snap guides', disabled: true, onchange })
    const input = screen.getByRole('switch')

    await userEvent.click(input)
    expect(input).not.toBeChecked()
    expect(onchange).not.toHaveBeenCalled()
  })
})
