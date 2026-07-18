import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Checkbox from './Checkbox.svelte'

describe('Checkbox', () => {
  it('renders a labelled checkbox', () => {
    render(Checkbox, { label: 'Include in cut list' })
    expect(screen.getByRole('checkbox', { name: 'Include in cut list' })).toBeInTheDocument()
  })

  it('toggles and fires onchange with the new state', async () => {
    const onchange = vi.fn()
    render(Checkbox, { label: 'Include in cut list', onchange })
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onchange).toHaveBeenCalledWith(true)
  })

  it('does not fire when disabled', async () => {
    const onchange = vi.fn()
    render(Checkbox, { label: 'Locked', disabled: true, onchange })
    await userEvent.click(screen.getByRole('checkbox'))
    expect(onchange).not.toHaveBeenCalled()
  })
})
