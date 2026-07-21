import { describe, expect, it } from 'vitest'

import { parseLength, parseViewBox, resolveUnits, scaleForTargetWidth } from './units'

describe('parseLength', () => {
  it('parses value and unit', () => {
    expect(parseLength('210mm')).toEqual({ value: 210, unit: 'mm' })
    expect(parseLength('12.5in')).toEqual({ value: 12.5, unit: 'in' })
    expect(parseLength('300')).toEqual({ value: 300, unit: null })
    expect(parseLength(undefined)).toBeNull()
  })
})

describe('parseViewBox', () => {
  it('parses four numbers, rejects bad boxes', () => {
    expect(parseViewBox('0 0 100 200')).toEqual({ x: 0, y: 0, width: 100, height: 200 })
    expect(parseViewBox('0,0,100,200')).toEqual({ x: 0, y: 0, width: 100, height: 200 })
    expect(parseViewBox('0 0 0 200')).toBeNull()
    expect(parseViewBox('bad')).toBeNull()
  })
})

describe('resolveUnits', () => {
  it('honours real width units against the viewBox (unambiguous)', () => {
    const r = resolveUnits({
      width: { value: 210, unit: 'mm' },
      height: { value: 297, unit: 'mm' },
      viewBox: { x: 0, y: 0, width: 420, height: 594 },
    })
    expect(r.ambiguous).toBe(false)
    expect(r.userUnitMm).toBeCloseTo(0.5, 9) // 210mm / 420 units
    expect(r.artworkWidthUser).toBe(420)
  })

  it('treats px as a real unit at 96 dpi', () => {
    const r = resolveUnits({
      width: { value: 96, unit: 'px' },
      height: { value: 96, unit: 'px' },
      viewBox: { x: 0, y: 0, width: 96, height: 96 },
    })
    expect(r.ambiguous).toBe(false)
    expect(r.userUnitMm).toBeCloseTo(25.4 / 96, 9)
  })

  it('is ambiguous with only a unitless viewBox (default 1 mm/unit)', () => {
    const r = resolveUnits({
      width: null,
      height: null,
      viewBox: { x: 0, y: 0, width: 100, height: 100 },
    })
    expect(r.ambiguous).toBe(true)
    expect(r.userUnitMm).toBe(1)
    expect(r.artworkWidthUser).toBe(100)
  })

  it('is ambiguous with unitless width/height', () => {
    const r = resolveUnits({
      width: { value: 300, unit: null },
      height: { value: 400, unit: null },
      viewBox: null,
    })
    expect(r.ambiguous).toBe(true)
    expect(r.userUnitMm).toBe(1)
  })
})

describe('scaleForTargetWidth', () => {
  it('scales so the artwork hits the target width', () => {
    expect(scaleForTargetWidth(100, 250)).toBeCloseTo(2.5, 9)
    expect(scaleForTargetWidth(0, 250)).toBe(1)
  })
})
