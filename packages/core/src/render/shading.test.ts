import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BACKLIGHT,
  TEXTURE_KIND,
  daylight,
  hexToRgb,
  litColor,
  rgbToHex,
  textureParams,
  transmission,
  type Rgb,
  type TextureTag,
  type TransparencyClass,
} from './shading'

const CLASSES: readonly TransparencyClass[] = ['transparent', 'translucent', 'opalescent', 'opaque']
const TAGS: readonly TextureTag[] = ['smooth', 'hammered', 'seedy', 'streaky', 'ripple', 'granite']

describe('transmission', () => {
  it('is strictly decreasing clear → solid (FR-2)', () => {
    const values = CLASSES.map(transmission)
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeLessThan(values[i - 1]!)
    }
  })

  it('every class is distinct and in (0, 1]', () => {
    const values = CLASSES.map(transmission)
    expect(new Set(values).size).toBe(CLASSES.length)
    for (const v of values) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('litColor', () => {
  const glass: Rgb = { r: 0.3, g: 0.3, b: 0.3 }

  it('produces distinct colours for distinct transparency classes (FR-2)', () => {
    const seen = CLASSES.map((c) => rgbToHex(litColor(glass, transmission(c), DEFAULT_BACKLIGHT)))
    expect(new Set(seen).size).toBe(CLASSES.length)
  })

  it('is monotonic non-decreasing in intensity, per channel', () => {
    let prev = litColor(glass, 0.7, { intensity: 0.2, warmth: 0 })
    for (const intensity of [0.5, 1, 1.5, 2]) {
      const next = litColor(glass, 0.7, { intensity, warmth: 0 })
      expect(next.r).toBeGreaterThanOrEqual(prev.r)
      expect(next.g).toBeGreaterThanOrEqual(prev.g)
      expect(next.b).toBeGreaterThanOrEqual(prev.b)
      prev = next
    }
  })

  it('is monotonic non-decreasing in transmission, per channel', () => {
    let prev = litColor(glass, 0, DEFAULT_BACKLIGHT)
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const next = litColor(glass, t, DEFAULT_BACKLIGHT)
      expect(next.r).toBeGreaterThanOrEqual(prev.r)
      expect(next.g).toBeGreaterThanOrEqual(prev.g)
      expect(next.b).toBeGreaterThanOrEqual(prev.b)
      prev = next
    }
  })

  it('clamps every channel to 0..1', () => {
    const c = litColor({ r: 1, g: 1, b: 1 }, 1, { intensity: 5, warmth: 0 })
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})

describe('daylight', () => {
  it('is neutral white at warmth 0', () => {
    expect(daylight(0)).toEqual({ r: 1, g: 1, b: 1 })
  })

  it('warm light pulls blue below red; cool light pulls red below blue', () => {
    const warm = daylight(1)
    expect(warm.b).toBeLessThan(warm.r)
    const cool = daylight(-1)
    expect(cool.r).toBeLessThan(cool.b)
  })

  it('clamps warmth beyond ±1', () => {
    expect(daylight(5)).toEqual(daylight(1))
    expect(daylight(-5)).toEqual(daylight(-1))
  })
})

describe('hex round-trip', () => {
  it('parses #rrggbb and #rgb', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 1, g: 0, b: 0 })
    expect(hexToRgb('#f00')).toEqual({ r: 1, g: 0, b: 0 })
  })

  it('round-trips a colour through rgb → hex', () => {
    expect(rgbToHex(hexToRgb('#3a7bd5'))).toBe('#3a7bd5')
  })

  it('falls back to mid grey on bad input', () => {
    expect(hexToRgb('not-a-colour')).toEqual({ r: 0.5, g: 0.5, b: 0.5 })
  })
})

describe('textureParams', () => {
  it('smooth glass has zero amplitude (no procedural texture)', () => {
    expect(textureParams('smooth').amplitude).toBe(0)
  })

  it('every tag maps to a distinct kind code and parameter set', () => {
    const kinds = TAGS.map((t) => textureParams(t).kind)
    expect(new Set(kinds).size).toBe(TAGS.length)
    const params = TAGS.map((t) => JSON.stringify(textureParams(t)))
    expect(new Set(params).size).toBe(TAGS.length)
  })

  it('kind codes match the stable TEXTURE_KIND table', () => {
    for (const t of TAGS) {
      expect(textureParams(t).kind).toBe(TEXTURE_KIND[t])
    }
  })

  it('anisotropic tags (streaky, ripple) stretch along one axis', () => {
    expect(textureParams('streaky').anisotropy).toBeGreaterThan(1)
    expect(textureParams('ripple').anisotropy).toBeGreaterThan(1)
    expect(textureParams('hammered').anisotropy).toBe(1)
  })
})
