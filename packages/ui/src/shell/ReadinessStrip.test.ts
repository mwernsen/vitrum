import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

import ReadinessStrip from './ReadinessStrip.svelte'

describe('ReadinessStrip — checks pill (F-030)', () => {
  it('reads "not run yet" before the first check', () => {
    render(ReadinessStrip, { pieceCount: 2, checksRun: false })
    const pill = screen.getByTestId('checks-readiness')
    expect(pill).toHaveTextContent('not run yet')
  })

  it('reads "clear" when a run finds nothing', () => {
    render(ReadinessStrip, {
      pieceCount: 2,
      checksRun: true,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
    })
    expect(screen.getByTestId('checks-readiness')).toHaveTextContent('clear')
  })

  it('counts issues across severities', () => {
    render(ReadinessStrip, {
      pieceCount: 3,
      checksRun: true,
      errorCount: 2,
      warningCount: 1,
      infoCount: 0,
    })
    expect(screen.getByTestId('checks-readiness')).toHaveTextContent('3 issues')
  })

  it('uses the singular for a lone issue', () => {
    render(ReadinessStrip, {
      pieceCount: 3,
      checksRun: true,
      errorCount: 0,
      warningCount: 0,
      infoCount: 1,
    })
    expect(screen.getByTestId('checks-readiness')).toHaveTextContent('1 issue')
  })
})

describe('ReadinessStrip — outputs pill (F-040)', () => {
  it('is dashed before any piece exists', () => {
    render(ReadinessStrip, { pieceCount: 0 })
    expect(screen.getByTestId('outputs-readiness')).toHaveTextContent('—')
  })

  it('shows the numbered ratio while some pieces are unnumbered', () => {
    render(ReadinessStrip, { pieceCount: 4, unnumberedCount: 1 })
    expect(screen.getByTestId('outputs-readiness')).toHaveTextContent('3/4 numbered')
  })

  it('reads "numbered" once every piece has a number', () => {
    render(ReadinessStrip, { pieceCount: 4, unnumberedCount: 0 })
    expect(screen.getByTestId('outputs-readiness')).toHaveTextContent('numbered')
  })
})
