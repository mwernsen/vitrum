import { CSS_PX_PER_MM } from '@vitrum/core'
import { afterEach, describe, expect, it } from 'vitest'

import { clearCalibration, defaultPxPerMm, loadCalibration, saveCalibration } from './calibration'

afterEach(() => {
  localStorage.clear()
})

describe('calibration', () => {
  it('defaults to the CSS-reference scale and no stored value', () => {
    expect(defaultPxPerMm()).toBeCloseTo(CSS_PX_PER_MM, 6)
    expect(loadCalibration()).toBeNull()
  })

  it('round-trips a saved factor', () => {
    saveCalibration(4.2)
    expect(loadCalibration()).toBeCloseTo(4.2, 6)
  })

  it('rejects non-positive or non-finite factors', () => {
    saveCalibration(0)
    saveCalibration(Number.NaN)
    expect(loadCalibration()).toBeNull()
  })

  it('clears a stored factor', () => {
    saveCalibration(3.9)
    clearCalibration()
    expect(loadCalibration()).toBeNull()
  })
})
