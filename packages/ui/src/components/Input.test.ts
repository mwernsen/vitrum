import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Input from './Input.svelte'

describe('Input', () => {
  it('renders the label and hint and defaults to the md size', () => {
    const { container } = render(Input, { label: 'Width', hint: 'in millimetres' })
    expect(screen.getByLabelText('Width')).toBeInTheDocument()
    expect(screen.getByText('in millimetres')).toBeInTheDocument()
    expect(container.querySelector('.field')).toHaveAttribute('data-size', 'md')
  })

  it('reflects the size prop as a data attribute', () => {
    const { container } = render(Input, { label: 'Width', size: 'sm' })
    expect(container.querySelector('.field')).toHaveAttribute('data-size', 'sm')
  })

  it('calls onchange with the new value as the user types', async () => {
    const onchange = vi.fn()
    render(Input, { label: 'Name', onchange })
    const input = screen.getByLabelText('Name')
    await userEvent.type(input, 'ab')
    expect(onchange).toHaveBeenLastCalledWith('ab')
    expect(input).toHaveValue('ab')
  })

  it('shows the error instead of the hint and marks the field invalid', () => {
    render(Input, { label: 'Name', error: 'Required', hint: 'ignored' })
    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(screen.queryByText('ignored')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
  })
})
