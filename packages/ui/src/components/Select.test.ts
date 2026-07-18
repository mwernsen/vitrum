import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Select from './Select.svelte'

const options = [
  { label: 'Copper foil', value: 'foil' },
  { label: 'Lead came', value: 'came' },
]

describe('Select', () => {
  it('renders the label and every option and defaults to the md size', () => {
    const { container } = render(Select, { label: 'Technique', options })
    expect(screen.getByLabelText('Technique')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Copper foil' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Lead came' })).toBeInTheDocument()
    expect(container.querySelector('.field')).toHaveAttribute('data-size', 'md')
  })

  it('reflects the size prop as a data attribute', () => {
    const { container } = render(Select, { label: 'Technique', options, size: 'sm' })
    expect(container.querySelector('.field')).toHaveAttribute('data-size', 'sm')
  })

  it('calls onchange with the selected value', async () => {
    const onchange = vi.fn()
    render(Select, { label: 'Technique', options, value: 'foil', onchange })
    const select = screen.getByLabelText('Technique')
    await userEvent.selectOptions(select, 'came')
    expect(onchange).toHaveBeenCalledWith('came')
    expect(select).toHaveValue('came')
  })
})
