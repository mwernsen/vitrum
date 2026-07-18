import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { createRawSnippet } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

import Tag from './Tag.svelte'

const children = createRawSnippet(() => ({ render: () => `<span>Ruby antique</span>` }))

describe('Tag', () => {
  it('renders its label', () => {
    render(Tag, { children })
    expect(screen.getByText('Ruby antique')).toBeInTheDocument()
  })

  it('renders a remove button only when onRemove is given, and fires it', async () => {
    const onRemove = vi.fn()
    const { rerender } = render(Tag, { children })
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()

    await rerender({ children, onRemove })
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})
