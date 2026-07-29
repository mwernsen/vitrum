import type { Glass, GlassId } from '@vitrum/model'
import type { NestResult } from '@vitrum/nest'
import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

import NestView from './NestView.svelte'

const glasses: Record<GlassId, Glass> = {
  g1: {
    id: 'g1',
    name: 'Cobalt blue',
    color: '#3a7bd5',
    transparency: 'transparent',
    texture: 'smooth',
    thicknessMm: 3,
  },
}

function result(): NestResult {
  const part = (label: string) => ({
    id: `p-${label}`,
    label,
    rotationDeg: 0,
    offset: { x: 0, y: 0 },
    ring: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ],
    holes: [],
    area: 1600,
  })
  return {
    seed: 1,
    totalSheets: 1,
    glasses: [
      {
        glassId: 'g1',
        sheetCount: 1,
        unplaced: [],
        utilization: 0.42,
        sheets: [
          {
            glassId: 'g1',
            index: 0,
            widthMm: 610,
            heightMm: 914,
            parts: [part('A1'), part('A2')],
            utilization: 0.42,
          },
        ],
      },
    ],
  }
}

describe('NestView (F-057)', () => {
  it('shows an empty state before the first nest', () => {
    render(NestView, { result: null, glasses, unit: 'mm', busy: false })
    expect(screen.getByText('Nothing nested yet')).toBeInTheDocument()
  })

  it('renders the glass group, per-sheet utilisation and piece labels', () => {
    render(NestView, { result: result(), glasses, unit: 'mm', busy: false })
    expect(screen.getByText('Cobalt blue')).toBeInTheDocument()
    // Utilisation shown as a rounded percentage.
    expect(screen.getAllByText('42%').length).toBeGreaterThan(0)
    expect(screen.getByText('Sheet 1')).toBeInTheDocument()
    // Piece numbers are printed onto the layout.
    expect(screen.getByText('A1')).toBeInTheDocument()
    expect(screen.getByText('A2')).toBeInTheDocument()
  })
})
