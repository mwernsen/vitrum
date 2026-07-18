import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { createRawSnippet } from 'svelte'

import Button from './Button.svelte'

const label = createRawSnippet(() => ({ render: () => `<span>Start free</span>` }))

describe('Button', () => {
  it('renders its children and defaults to the primary/md variant', () => {
    render(Button, { children: label })
    const button = screen.getByRole('button', { name: 'Start free' })
    expect(button).toHaveAttribute('data-variant', 'primary')
    expect(button).toHaveAttribute('data-size', 'md')
  })

  it('reflects variant and size props as data attributes', () => {
    render(Button, { children: label, variant: 'accent', size: 'lg' })
    const button = screen.getByRole('button', { name: 'Start free' })
    expect(button).toHaveAttribute('data-variant', 'accent')
    expect(button).toHaveAttribute('data-size', 'lg')
  })

  it('fires onclick when pressed and not when disabled', async () => {
    const onclick = vi.fn()
    const { rerender } = render(Button, { children: label, onclick })
    await userEvent.click(screen.getByRole('button'))
    expect(onclick).toHaveBeenCalledTimes(1)

    await rerender({ children: label, onclick, disabled: true })
    await userEvent.click(screen.getByRole('button'))
    expect(onclick).toHaveBeenCalledTimes(1)
  })
})
