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

  it('shows the panel and no detected pieces for an empty document', () => {
    render(App)
    expect(screen.getByRole('heading', { level: 2, name: 'Sample panel' })).toBeInTheDocument()
    // The inspector now reflects real F-020 detection; an empty document has zero pieces.
    expect(screen.getByTestId('inspector-piece-count')).toHaveTextContent('0')
    expect(screen.getByText('Draw a closed region to detect a piece.')).toBeInTheDocument()
  })
})
