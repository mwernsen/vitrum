import { render, screen } from '@testing-library/svelte'
import { createRawSnippet } from 'svelte'
import { describe, expect, it } from 'vitest'

import Tooltip from './Tooltip.svelte'

const children = createRawSnippet(() => ({ render: () => `<button>Snap</button>` }))

describe('Tooltip', () => {
  it('renders the trigger and the tip labelled by the label prop', () => {
    render(Tooltip, { label: 'Snap to grid', children, side: 'bottom' })
    expect(screen.getByRole('button', { name: 'Snap' })).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Snap to grid')
  })
})
