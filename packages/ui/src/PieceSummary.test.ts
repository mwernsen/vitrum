import type { GlassPiece } from '@vitrum/core'
import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

import PieceSummary from './PieceSummary.svelte'

const square10cm: GlassPiece = {
  id: 'sq',
  label: 'Border square',
  color: '#dc2626',
  vertices: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
}

describe('PieceSummary', () => {
  it('shows the piece label', () => {
    render(PieceSummary, { piece: square10cm })
    expect(screen.getByText('Border square')).toBeInTheDocument()
  })

  it('shows area in cm² and lead length in cm', () => {
    render(PieceSummary, { piece: square10cm })
    expect(screen.getByText('100 cm² · 40 cm lead')).toBeInTheDocument()
  })
})
