import { describe, expect, it } from 'vitest'

import { MAX_PANEL_MM, validateNewPanel } from './newPanel'

const form = (over: Partial<Parameters<typeof validateNewPanel>[0]> = {}) =>
  validateNewPanel({ name: 'Rose', width: '300', height: '400', units: 'mm', ...over })

describe('validateNewPanel (F-058 FR-3)', () => {
  it('accepts a plain millimetre panel and passes the dimensions through', () => {
    const result = form()
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual({})
    expect(result.name).toBe('Rose')
    expect(result.widthMm).toBe(300)
    expect(result.heightMm).toBe(400)
  })

  it('converts inch input to the millimetres the document stores', () => {
    const result = form({ width: '12', height: '16', units: 'in' })
    expect(result.ok).toBe(true)
    expect(result.widthMm).toBeCloseTo(304.8, 6)
    expect(result.heightMm).toBeCloseTo(406.4, 6)
  })

  it('accepts a comma decimal separator', () => {
    expect(form({ width: '40,5' }).widthMm).toBeCloseTo(40.5, 6)
  })

  it('trims the name and falls back to "Untitled panel" when blank', () => {
    expect(form({ name: '  Chapel light  ' }).name).toBe('Chapel light')
    const blank = form({ name: '   ' })
    expect(blank.ok).toBe(true)
    expect(blank.name).toBe('Untitled panel')
  })

  it.each([
    ['', 'Enter a size'],
    ['   ', 'Enter a size'],
    ['abc', 'Enter a number'],
    ['0', 'Must be greater than zero'],
    ['-5', 'Must be greater than zero'],
  ])('rejects width %j', (width, message) => {
    const result = form({ width })
    expect(result.ok).toBe(false)
    expect(result.errors.width).toBe(message)
    expect(result.widthMm).toBe(0)
  })

  it('reports each bad dimension under its own field', () => {
    const result = form({ width: '0', height: '' })
    expect(result.errors).toEqual({ width: 'Must be greater than zero', height: 'Enter a size' })
  })

  it('rejects a panel past the sanity ceiling, in either unit', () => {
    expect(form({ width: String(MAX_PANEL_MM + 1) }).errors.width).toBe('Too large for one panel')
    // 400 in ≈ 10 160 mm, just past the ceiling.
    expect(form({ width: '400', units: 'in' }).errors.width).toBe('Too large for one panel')
    expect(form({ width: String(MAX_PANEL_MM) }).ok).toBe(true)
  })
})
