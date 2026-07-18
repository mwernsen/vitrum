import { describe, expect, it } from 'vitest'

import { convertLength, formatLength } from './index'

describe('convertLength', () => {
  it('leaves millimetres unchanged', () => {
    expect(convertLength(300, 'mm')).toBe(300)
  })

  it('converts millimetres to inches', () => {
    expect(convertLength(25.4, 'in')).toBeCloseTo(1, 10)
    expect(convertLength(304.8, 'in')).toBeCloseTo(12, 10)
  })
})

describe('formatLength', () => {
  it('formats millimetres with one decimal', () => {
    expect(formatLength(300, 'mm')).toBe('300.0 mm')
  })

  it('formats inches with two decimals', () => {
    expect(formatLength(25.4, 'in')).toBe('1.00 in')
  })
})
