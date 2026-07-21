import { describe, expect, it } from 'vitest'

import {
  areaToM2,
  convertLength,
  formatArea,
  formatAreaLarge,
  formatFractionalInch,
  formatLength,
} from './index'

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

  it('formats inches as a reduced fraction when asked', () => {
    expect(formatLength(92.075, 'in', { fractional: true })).toBe('3 5/8"')
    // Fractional option is a no-op for millimetres.
    expect(formatLength(300, 'mm', { fractional: true })).toBe('300.0 mm')
  })
})

describe('formatFractionalInch', () => {
  it('reduces the fraction to lowest terms', () => {
    expect(formatFractionalInch(92.075)).toBe('3 5/8"') // 3.625"
    expect(formatFractionalInch(1.5875)).toBe('1/16"') // 0.0625"
    expect(formatFractionalInch(9.525)).toBe('3/8"') // 0.375"
  })

  it('drops the fraction for whole inches and shows a bare zero', () => {
    expect(formatFractionalInch(25.4)).toBe('1"')
    expect(formatFractionalInch(0)).toBe('0"')
  })

  it('rounds to the nearest 1/32 and carries a full inch', () => {
    // 0.995" rounds to 32/32 ⇒ carries to 1".
    expect(formatFractionalInch(0.995 * 25.4)).toBe('1"')
  })

  it('keeps the sign of negative lengths', () => {
    expect(formatFractionalInch(-92.075)).toBe('-3 5/8"')
  })
})

describe('formatArea (F-042)', () => {
  it('formats small areas as cm² in mm mode', () => {
    // 10 000 mm² = 1 cm² × 100 = 100 cm².
    expect(formatArea(10_000, 'mm')).toBe('100.0 cm²')
    expect(formatArea(2_500, 'mm')).toBe('25.0 cm²')
  })

  it('formats small areas as in² in inch mode', () => {
    // 1 in² = 645.16 mm².
    expect(formatArea(645.16, 'in')).toBe('1.00 in²')
    expect(formatArea(6451.6, 'in')).toBe('10.00 in²')
  })
})

describe('formatAreaLarge (F-042)', () => {
  it('formats purchasing areas as m² in mm mode', () => {
    expect(formatAreaLarge(1_000_000, 'mm')).toBe('1.000 m²')
    expect(formatAreaLarge(250_000, 'mm')).toBe('0.250 m²')
  })

  it('formats purchasing areas as ft² in inch mode', () => {
    // 1 ft² = 144 in² = 92 903.04 mm².
    expect(formatAreaLarge(92_903.04, 'in')).toBe('1.00 ft²')
  })
})

describe('areaToM2 (F-042)', () => {
  it('converts mm² to m²', () => {
    expect(areaToM2(1_000_000)).toBe(1)
    expect(areaToM2(500_000)).toBe(0.5)
  })
})
