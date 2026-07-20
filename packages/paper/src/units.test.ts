import { describe, expect, it } from 'vitest'

import {
  MM_PER_INCH,
  PT_PER_INCH,
  PAPER_SIZES,
  mmToPt,
  orientedSize,
  paperSize,
  ptToMm,
} from './units'

describe('mm ↔ pt conversion', () => {
  it('one inch is 72 pt and 25.4 mm', () => {
    expect(mmToPt(MM_PER_INCH)).toBeCloseTo(PT_PER_INCH, 10)
    expect(ptToMm(PT_PER_INCH)).toBeCloseTo(MM_PER_INCH, 10)
  })

  it('a 100 mm calibration length is 283.4645… pt', () => {
    expect(mmToPt(100)).toBeCloseTo(283.46456692913387, 6)
  })

  it('round-trips mm → pt → mm exactly enough for print fidelity', () => {
    for (const mm of [0, 0.5, 15, 100, 210, 297, 5000]) {
      expect(ptToMm(mmToPt(mm))).toBeCloseTo(mm, 9)
    }
  })

  it('A4 is 210 × 297 mm ≈ 595.28 × 841.89 pt', () => {
    expect(mmToPt(210)).toBeCloseTo(595.2755905511812, 6)
    expect(mmToPt(297)).toBeCloseTo(841.8897637795277, 6)
  })
})

describe('paper sizes', () => {
  it('exposes A4, A3 and Letter in portrait (height ≥ width)', () => {
    for (const size of PAPER_SIZES) expect(size.heightMm).toBeGreaterThanOrEqual(size.widthMm)
    expect(paperSize('a4')).toEqual({ id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 })
    expect(paperSize('nope')).toBeUndefined()
  })

  it('landscape swaps width and height', () => {
    const a4 = paperSize('a4')!
    expect(orientedSize(a4, 'portrait')).toEqual({ widthMm: 210, heightMm: 297 })
    expect(orientedSize(a4, 'landscape')).toEqual({ widthMm: 297, heightMm: 210 })
  })
})
