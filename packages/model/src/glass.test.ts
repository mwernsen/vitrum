import { describe, expect, it } from 'vitest'

import {
  fitWithin,
  filterGlasses,
  hueBucket,
  matchesGlass,
  starterGlasses,
  STARTER_GLASSES,
  SWATCH_MAX_PX,
} from './glass'
import type { Glass } from './types'

const g = (over: Partial<Glass>): Glass => ({
  id: 'x',
  name: 'Test',
  color: '#808080',
  transparency: 'transparent',
  texture: 'smooth',
  thicknessMm: 3,
  ...over,
})

describe('starter catalog (FR-2)', () => {
  it('ships ~60 glasses spanning the palette', () => {
    expect(STARTER_GLASSES.length).toBeGreaterThanOrEqual(55)
    expect(STARTER_GLASSES.length).toBeLessThanOrEqual(65)
  })

  it('has unique ids', () => {
    const ids = STARTER_GLASSES.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('covers every hue bucket and every transparency class', () => {
    const hues = new Set(STARTER_GLASSES.map((x) => hueBucket(x.color)))
    for (const h of [
      'red',
      'orange',
      'yellow',
      'green',
      'teal',
      'blue',
      'purple',
      'pink',
      'neutral',
    ]) {
      expect(hues.has(h as never)).toBe(true)
    }
    const trans = new Set(STARTER_GLASSES.map((x) => x.transparency))
    expect(trans).toEqual(new Set(['transparent', 'translucent', 'opalescent', 'opaque']))
  })

  it('is deeply frozen — the shipped data cannot be mutated (copy-on-write)', () => {
    expect(Object.isFrozen(STARTER_GLASSES)).toBe(true)
    for (const glass of STARTER_GLASSES) {
      expect(Object.isFrozen(glass)).toBe(true)
      expect(() => {
        ;(glass as { name: string }).name = 'mutated'
      }).toThrow()
    }
  })

  it('starterGlasses() returns fresh, independent copies each call', () => {
    const a = starterGlasses()
    const b = starterGlasses()
    expect(a).toEqual(b)
    expect(a[0]).not.toBe(b[0]) // distinct objects
    expect(a[0]).not.toBe(STARTER_GLASSES[0])
    // Mutating a copy must not touch the shipped constant.
    ;(a[0] as { name: string }).name = 'edited'
    expect(STARTER_GLASSES[0]!.name).not.toBe('edited')
  })

  it('every starter glass uses only the six valid texture tags', () => {
    const valid = new Set(['smooth', 'hammered', 'seedy', 'streaky', 'ripple', 'granite'])
    for (const glass of STARTER_GLASSES) expect(valid.has(glass.texture)).toBe(true)
  })
})

describe('hueBucket', () => {
  it('buckets saturated colours by wheel position', () => {
    expect(hueBucket('#d81e2c')).toBe('red')
    expect(hueBucket('#e07a1f')).toBe('orange')
    expect(hueBucket('#e8c02a')).toBe('yellow')
    expect(hueBucket('#1f7a4d')).toBe('green')
    expect(hueBucket('#137a83')).toBe('teal')
    expect(hueBucket('#1c3f9b')).toBe('blue')
    expect(hueBucket('#6a3d99')).toBe('purple')
    expect(hueBucket('#c04a78')).toBe('pink')
  })

  it('buckets clear / white / grey / black as neutral', () => {
    expect(hueBucket('#f2f4f5')).toBe('neutral') // clear
    expect(hueBucket('#ffffff')).toBe('neutral')
    expect(hueBucket('#808080')).toBe('neutral')
    expect(hueBucket('#141517')).toBe('neutral') // near-black
  })

  it('falls back to neutral on an unparseable colour', () => {
    expect(hueBucket('not-a-color')).toBe('neutral')
  })
})

describe('search / filter (FR-3)', () => {
  const glasses: Glass[] = [
    g({
      id: '1',
      name: 'Ruby cathedral',
      color: '#9b1b26',
      transparency: 'transparent',
      texture: 'smooth',
      manufacturer: 'Aurora Glass',
      sku: 'AG-1101',
    }),
    g({
      id: '2',
      name: 'Emerald cathedral',
      color: '#1f7a4d',
      transparency: 'transparent',
      texture: 'seedy',
      manufacturer: 'Aurora Glass',
      sku: 'AG-1408',
    }),
    g({
      id: '3',
      name: 'Navy opaque',
      color: '#22335f',
      transparency: 'opaque',
      texture: 'granite',
      manufacturer: 'Old Forge',
      sku: 'OF-131',
    }),
  ]

  it('matches free text across name, manufacturer, sku, texture, transparency', () => {
    expect(filterGlasses(glasses, { query: 'ruby' }).map((x) => x.id)).toEqual(['1'])
    expect(filterGlasses(glasses, { query: 'aurora' }).map((x) => x.id)).toEqual(['1', '2'])
    expect(filterGlasses(glasses, { query: 'OF-131' }).map((x) => x.id)).toEqual(['3'])
    expect(filterGlasses(glasses, { query: 'granite' }).map((x) => x.id)).toEqual(['3'])
    expect(filterGlasses(glasses, { query: 'opaque' }).map((x) => x.id)).toEqual(['3'])
  })

  it('is case-insensitive and ignores a blank query', () => {
    expect(filterGlasses(glasses, { query: '  RuBy ' }).map((x) => x.id)).toEqual(['1'])
    expect(filterGlasses(glasses, { query: '   ' })).toHaveLength(3)
  })

  it('filters by hue, transparency and texture facets (AND)', () => {
    expect(filterGlasses(glasses, { hue: 'green' }).map((x) => x.id)).toEqual(['2'])
    expect(filterGlasses(glasses, { transparency: 'opaque' }).map((x) => x.id)).toEqual(['3'])
    expect(filterGlasses(glasses, { texture: 'seedy' }).map((x) => x.id)).toEqual(['2'])
    expect(filterGlasses(glasses, { query: 'cathedral', hue: 'red' }).map((x) => x.id)).toEqual([
      '1',
    ])
    expect(matchesGlass(glasses[0]!, { hue: 'green' })).toBe(false)
  })

  it('preserves input order', () => {
    expect(filterGlasses(glasses, {}).map((x) => x.id)).toEqual(['1', '2', '3'])
  })
})

describe('fitWithin (FR-5 swatch downscale sizing)', () => {
  it('never upscales', () => {
    expect(fitWithin(100, 80, 512)).toEqual({ width: 100, height: 80 })
  })

  it('caps the longest side and preserves aspect ratio', () => {
    expect(fitWithin(1024, 512, 512)).toEqual({ width: 512, height: 256 })
    expect(fitWithin(512, 1024, 512)).toEqual({ width: 256, height: 512 })
    expect(fitWithin(2000, 1000, SWATCH_MAX_PX)).toEqual({ width: 512, height: 256 })
  })

  it('clamps to at least 1px and handles degenerate sizes', () => {
    expect(fitWithin(10000, 1, 512)).toEqual({ width: 512, height: 1 })
    expect(fitWithin(0, 0, 512)).toEqual({ width: 0, height: 0 })
  })
})
