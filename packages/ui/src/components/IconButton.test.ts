import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

import IconButton from './IconButton.svelte'

describe('IconButton', () => {
  it('exposes its label as the accessible name and title', () => {
    render(IconButton, { label: 'Undo' })
    const button = screen.getByRole('button', { name: 'Undo' })
    expect(button).toHaveAttribute('title', 'Undo')
    expect(button).toHaveAttribute('data-variant', 'ghost')
    expect(button).toHaveAttribute('data-size', 'md')
  })

  it('reflects variant and size', () => {
    render(IconButton, { label: 'Export', variant: 'outline', size: 'lg' })
    const button = screen.getByRole('button', { name: 'Export' })
    expect(button).toHaveAttribute('data-variant', 'outline')
    expect(button).toHaveAttribute('data-size', 'lg')
  })
})
