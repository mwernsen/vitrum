import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

import App from './App.svelte'

describe('App', () => {
  it('renders the cockpit shell', () => {
    render(App)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByRole('main', { name: 'Design canvas' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Status bar' })).toBeInTheDocument()
  })

  it('names the open document, with no geometry yet', () => {
    render(App)
    // The chip reads the *document's* own name now the new-panel dialog sets it (F-058 FR-3); the
    // hardcoded "Sample panel" placeholder is gone. The readiness meter reflects real F-020
    // detection — an empty document has cleared none of the four steps.
    expect(screen.getByTestId('document-chip')).toHaveTextContent('Untitled')
    expect(screen.getByTestId('readiness-meter')).toHaveTextContent('0 / 4')
  })
})
