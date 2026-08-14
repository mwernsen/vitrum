import { describe, expect, it } from 'vitest'

import {
  REFERENCE_THICKNESS_MM,
  fresnelSheen,
  heightField,
  hueDriftMultiplier,
  pathDepthFactor,
  pathRatio,
  surfaceNormal,
  surfaceParams,
  type TextureTag,
  type TransparencyClass,
} from './shading'

const TAGS: TextureTag[] = ['smooth', 'hammered', 'seedy', 'streaky', 'ripple', 'granite']
const CLASSES: TransparencyClass[] = ['transparent', 'translucent', 'opalescent', 'opaque']

/** Sample a field over a spread of world-mm points, so assertions are not one lucky coordinate. */
const samples = (n = 40): { x: number; y: number }[] =>
  Array.from({ length: n }, (_, i) => ({ x: i * 3.7 - 40, y: i * 5.3 - 55 }))

describe('surfaceParams (F-064 thrust A)', () => {
  it('gives every texture tag a distinct relief depth', () => {
    const reliefs = TAGS.map((t) => surfaceParams(t, 'transparent').reliefMm)
    expect(new Set(reliefs).size).toBe(TAGS.length)
  })

  it('keeps smooth glass the flattest and hammered the deepest', () => {
    const relief = (t: TextureTag): number => surfaceParams(t, 'transparent').reliefMm
    for (const tag of TAGS.filter((t) => t !== 'smooth')) {
      expect(relief('smooth')).toBeLessThan(relief(tag))
    }
    expect(Math.max(...TAGS.map(relief))).toBe(relief('hammered'))
  })

  it('gives smooth glass a relief that is faint but never zero', () => {
    // Real antique glass is not an optical plane; a dead-flat surface is what read as paint.
    const { reliefMm } = surfaceParams('smooth', 'transparent')
    expect(reliefMm).toBeGreaterThan(0)
    expect(reliefMm).toBeLessThan(0.2)
  })

  it('makes gloss fall monotonically as glass gets denser', () => {
    for (const tag of TAGS) {
      const gloss = CLASSES.map((c) => surfaceParams(tag, c).gloss)
      for (let i = 1; i < gloss.length; i++) {
        expect(gloss[i]!).toBeLessThan(gloss[i - 1]!)
      }
    }
  })

  it('drifts streaky glass in hue more than any other tag', () => {
    const drift = (t: TextureTag): number => surfaceParams(t, 'transparent').hueDrift
    for (const tag of TAGS.filter((t) => t !== 'streaky')) {
      expect(drift(tag)).toBeLessThan(drift('streaky'))
    }
  })
})

describe('heightField', () => {
  it('stays within 0..1 for every tag across a wide area', () => {
    for (const tag of TAGS) {
      for (const { x, y } of samples()) {
        const h = heightField(tag, x, y)
        expect(h).toBeGreaterThanOrEqual(0)
        expect(h).toBeLessThanOrEqual(1)
      }
    }
  })

  it('actually varies for every tag — no tag is a constant plane', () => {
    for (const tag of TAGS) {
      const heights = samples().map(({ x, y }) => heightField(tag, x, y))
      expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.05)
    }
  })

  it('is deterministic', () => {
    expect(heightField('hammered', 12.5, -7.25)).toBe(heightField('hammered', 12.5, -7.25))
  })

  it('gives the tags distinct fields', () => {
    // Two tags agreeing everywhere would mean they render identically.
    for (let i = 0; i < TAGS.length; i++) {
      for (let k = i + 1; k < TAGS.length; k++) {
        const differs = samples().some(
          ({ x, y }) => Math.abs(heightField(TAGS[i]!, x, y) - heightField(TAGS[k]!, x, y)) > 1e-6,
        )
        expect(differs).toBe(true)
      }
    }
  })

  it('runs streaky glass along one axis', () => {
    // Anisotropy stretches the field across x, so x varies far more slowly than y.
    const alongX = Math.abs(heightField('streaky', 0, 0) - heightField('streaky', 6, 0))
    const alongY = Math.abs(heightField('streaky', 0, 0) - heightField('streaky', 0, 6))
    expect(alongX).toBeLessThan(alongY)
  })
})

describe('surfaceNormal', () => {
  it('returns unit-length normals facing the viewer', () => {
    for (const tag of TAGS) {
      const { reliefMm, normalStepMm } = surfaceParams(tag, 'transparent')
      for (const { x, y } of samples(12)) {
        const n = surfaceNormal(tag, x, y, reliefMm, normalStepMm)
        expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 10)
        expect(n.z).toBeGreaterThan(0)
      }
    }
  })

  it('is dead flat when relief is zero', () => {
    const n = surfaceNormal('hammered', 3, 4, 0, 2)
    // toBeCloseTo rather than toEqual: a zero slope legitimately yields signed zero.
    expect(n.x).toBeCloseTo(0, 12)
    expect(n.y).toBeCloseTo(0, 12)
    expect(n.z).toBeCloseTo(1, 12)
  })

  it('tilts further as relief deepens', () => {
    // More physical depth means steeper slopes, so the normal leans away from the viewer.
    const shallow = surfaceNormal('hammered', 3.5, 2.5, 0.2, 2.2)
    const deep = surfaceNormal('hammered', 3.5, 2.5, 2, 2.2)
    expect(deep.z).toBeLessThan(shallow.z)
  })

  it('survives a degenerate step without producing NaN', () => {
    const n = surfaceNormal('granite', 1, 1, 0.5, 0)
    expect(Number.isFinite(n.x + n.y + n.z)).toBe(true)
    expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 10)
  })
})

describe('pathRatio', () => {
  it('is exactly 1 for reference-thickness glass seen through a flat face', () => {
    expect(pathRatio(REFERENCE_THICKNESS_MM, 1)).toBeCloseTo(1, 12)
  })

  it('grows with thickness', () => {
    expect(pathRatio(6, 1)).toBeGreaterThan(pathRatio(3, 1))
    expect(pathRatio(3, 1)).toBeGreaterThan(pathRatio(2, 1))
  })

  it('grows as the surface tilts away', () => {
    expect(pathRatio(3, 0.5)).toBeGreaterThan(pathRatio(3, 1))
  })

  it('clamps a near-edge-on slope so the path cannot run away', () => {
    expect(pathRatio(3, 1e-6)).toBe(pathRatio(3, 0.25))
    expect(Number.isFinite(pathRatio(3, 0))).toBe(true)
  })
})

describe('pathDepthFactor', () => {
  const ruby = { r: 0.72, g: 0.08, b: 0.11 }

  it('is the identity at the reference path, so litColor is reproduced untouched', () => {
    const f = pathDepthFactor(ruby, 1)
    expect(f.r).toBeCloseTo(1, 12)
    expect(f.g).toBeCloseTo(1, 12)
    expect(f.b).toBeCloseTo(1, 12)
  })

  it('darkens on a longer path and lightens on a shorter one', () => {
    expect(pathDepthFactor(ruby, 1.6).r).toBeLessThan(1)
    expect(pathDepthFactor(ruby, 0.6).r).toBeGreaterThan(1)
  })

  it('deepens a saturated channel faster than a bright one', () => {
    // Ruby's green is nearly absorbed already, so extra path hits it much harder than the red.
    const f = pathDepthFactor(ruby, 1.5)
    expect(f.g).toBeLessThan(f.r)
  })

  it('stays finite for pure black, which would otherwise be a log singularity', () => {
    const f = pathDepthFactor({ r: 0, g: 0, b: 0 }, 2)
    expect(Number.isFinite(f.r + f.g + f.b)).toBe(true)
  })
})

describe('fresnelSheen', () => {
  it('is weak head-on and strong at grazing angles', () => {
    expect(fresnelSheen(1, 1)).toBeCloseTo(0.04, 6)
    expect(fresnelSheen(0, 1)).toBeCloseTo(1, 6)
  })

  it('rises monotonically as the surface tilts away', () => {
    const zs = [1, 0.9, 0.7, 0.5, 0.3, 0.1, 0]
    const sheens = zs.map((z) => fresnelSheen(z, 1))
    for (let i = 1; i < sheens.length; i++) {
      expect(sheens[i]!).toBeGreaterThan(sheens[i - 1]!)
    }
  })

  it('scales with gloss, so dense glass reflects less', () => {
    expect(fresnelSheen(0.5, 0.4)).toBeLessThan(fresnelSheen(0.5, 1))
    expect(fresnelSheen(0.5, 0)).toBe(0)
  })
})

describe('hueDriftMultiplier', () => {
  it('is the identity when the glass does not drift', () => {
    expect(hueDriftMultiplier(0, 5, 9)).toEqual({ r: 1, g: 1, b: 1 })
  })

  it('pushes warm and cool in opposite directions', () => {
    // A drift that lifted every channel together would just be brightness noise again.
    const drifted = samples(30)
      .map(({ x, y }) => hueDriftMultiplier(0.5, x, y))
      .filter((m) => Math.abs(m.r - 1) > 1e-3)
    expect(drifted.length).toBeGreaterThan(0)
    for (const m of drifted) expect((m.r - 1) * (m.b - 1)).toBeLessThan(0)
  })

  it('drifts further as the amount rises', () => {
    const spread = (amount: number): number => {
      const rs = samples(30).map(({ x, y }) => hueDriftMultiplier(amount, x, y).r)
      return Math.max(...rs) - Math.min(...rs)
    }
    expect(spread(0.5)).toBeGreaterThan(spread(0.1))
  })
})
