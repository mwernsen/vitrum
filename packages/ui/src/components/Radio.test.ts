import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Radio from './Radio.svelte'

describe('Radio', () => {
  it('renders a labelled radio input', () => {
    render(Radio, { label: 'Millimeters', name: 'unit', value: 'mm' })
    const input = screen.getByRole('radio', { name: 'Millimeters' })
    expect(input).toHaveAttribute('name', 'unit')
    expect(input).toHaveProperty('value', 'mm')
  })

  it('fires onchange when selected', async () => {
    const onchange = vi.fn()
    render(Radio, { label: 'Millimeters', name: 'unit', value: 'mm', onchange })
    await userEvent.click(screen.getByRole('radio', { name: 'Millimeters' }))
    expect(onchange).toHaveBeenCalledWith(true)
  })

  it('does not fire when disabled', async () => {
    const onchange = vi.fn()
    render(Radio, { label: 'Inches', value: 'in', disabled: true, onchange })
    await userEvent.click(screen.getByRole('radio', { name: 'Inches' }))
    expect(onchange).not.toHaveBeenCalled()
  })
})
