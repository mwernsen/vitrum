import { render, screen } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { describe, expect, it } from 'vitest'

import Badge from './Badge.svelte'

const children = createRawSnippet(() => ({ render: () => `<span>Fired</span>` }))

describe('Badge', () => {
  it('renders its children and defaults to the neutral tone', () => {
    const { container } = render(Badge, { children })
    expect(screen.getByText('Fired')).toBeInTheDocument()
    expect(container.querySelector('.badge')).toHaveAttribute('data-tone', 'neutral')
  })

  it('reflects the tone prop', () => {
    const { container } = render(Badge, { children, tone: 'success' })
    expect(container.querySelector('.badge')).toHaveAttribute('data-tone', 'success')
  })
})
