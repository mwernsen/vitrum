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

  it('shows the sample panel in the inspector', () => {
    render(App)
    expect(screen.getByRole('heading', { level: 2, name: 'Sample panel' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })
})
