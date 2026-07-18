import { describe, expect, it } from 'vitest'

import { isNumericChar, parseNumericEntry } from './numeric'

describe('parseNumericEntry', () => {
  it('parses a bare length in mm (FR-2)', () => {
    expect(parseNumericEntry('120', 'mm')).toEqual({ length: 120 })
  })

  it('converts an inch-unit length to millimetres', () => {
    expect(parseNumericEntry('2', 'in')).toEqual({ length: 50.8 })
  })

  it('parses length and angle separated by a comma', () => {
    expect(parseNumericEntry('120, 30', 'mm')).toEqual({ length: 120, angle: 30 })
  })

  it('parses length and angle separated by whitespace', () => {
    expect(parseNumericEntry('120 30', 'mm')).toEqual({ length: 120, angle: 30 })
  })

  it('parses an angle-only entry (leading @ or comma)', () => {
    expect(parseNumericEntry('@45', 'mm')).toEqual({ angle: 45 })
    expect(parseNumericEntry(',45', 'mm')).toEqual({ angle: 45 })
  })

  it('accepts decimals and negatives', () => {
    expect(parseNumericEntry('12.5, -90', 'mm')).toEqual({ length: 12.5, angle: -90 })
  })

  it('returns null for empty or malformed input', () => {
    expect(parseNumericEntry('', 'mm')).toBeNull()
    expect(parseNumericEntry('   ', 'mm')).toBeNull()
    expect(parseNumericEntry('abc', 'mm')).toBeNull()
  })
})

describe('isNumericChar', () => {
  it('accepts digits, sign, point and separators', () => {
    for (const c of '0123456789.,- ') expect(isNumericChar(c)).toBe(true)
  })

  it('rejects letters and multi-char strings', () => {
    expect(isNumericChar('a')).toBe(false)
    expect(isNumericChar('12')).toBe(false)
  })
})
