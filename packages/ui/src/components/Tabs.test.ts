import { render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Tabs from './Tabs.svelte'

const items = [
  { label: 'Panels', value: 'panels' },
  { label: 'Cut lists', value: 'cuts' },
  { label: 'Glass', value: 'glass' },
]

describe('Tabs', () => {
  it('marks the selected tab with aria-selected', () => {
    render(Tabs, { items, value: 'cuts' })
    expect(screen.getByRole('tab', { name: 'Cut lists' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Panels' })).toHaveAttribute('aria-selected', 'false')
  })

  it('fires onchange with the clicked tab value', async () => {
    const onchange = vi.fn()
    render(Tabs, { items, value: 'panels', onchange })
    await userEvent.click(screen.getByRole('tab', { name: 'Glass' }))
    expect(onchange).toHaveBeenCalledWith('glass')
  })

  it('accepts bare string items', () => {
    render(Tabs, { items: ['Panels', 'Glass'], value: 'Glass' })
    expect(screen.getByRole('tab', { name: 'Glass' })).toHaveAttribute('aria-selected', 'true')
  })
})
