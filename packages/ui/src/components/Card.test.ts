import { render, screen } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { describe, expect, it } from 'vitest'

import Card from './Card.svelte'

const children = createRawSnippet(() => ({ render: () => `<h3>Rose window</h3>` }))

describe('Card', () => {
  it('renders its children', () => {
    render(Card, { children })
    expect(screen.getByRole('heading', { name: 'Rose window' })).toBeInTheDocument()
  })

  it('marks interactive and dark variants via data attributes', () => {
    const { container } = render(Card, { children, interactive: true, dark: true })
    const card = container.querySelector('.card')
    expect(card).toHaveAttribute('data-interactive', 'true')
    expect(card).toHaveAttribute('data-dark', 'true')
  })
})
