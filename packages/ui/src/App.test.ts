import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

import App from './App.svelte'

describe('App', () => {
  it('renders the four-region app shell', () => {
    render(App)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByRole('main', { name: 'Design canvas' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Status bar' })).toBeInTheDocument()
  })

  it('opens the sample panel on an empty document with no geometry yet', () => {
    render(App)
    // Panel name lives in the top bar; the readiness strip reflects real F-020 detection —
    // an empty document has no completed geometry.
    expect(screen.getByText('Sample panel')).toBeInTheDocument()
    expect(screen.getByText('in progress')).toBeInTheDocument()
  })
})
