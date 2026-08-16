import { describe, expect, it } from 'vitest'

import {
  applyToPoint,
  applyToVector,
  compose,
  determinant,
  IDENTITY,
  invert,
  rotation,
  scaling,
  transformCurve,
  transformShape,
  translation,
} from './transform'
import { arc, cubic, line, polygon, polyline } from './types'
import { distance, vec2 } from './vec2'

describe('basic transforms', () => {
  it('applies identity, translation and scaling to points', () => {
    expect(applyToPoint(IDENTITY, vec2(3, 4))).toEqual(vec2(3, 4))
    expect(applyToPoint(translation(5, -2), vec2(3, 4))).toEqual(vec2(8, 2))
    expect(applyToPoint(scaling(2, 3), vec2(3, 4))).toEqual(vec2(6, 12))
  })

  it('rotates about the origin and about a centre', () => {
    const r = applyToPoint(rotation(Math.PI / 2), vec2(1, 0))
    expect(r.x).toBeCloseTo(0)
    expect(r.y).toBeCloseTo(1)
    const about = applyToPoint(rotation(Math.PI, vec2(2, 2)), vec2(3, 2))
    expect(about.x).toBeCloseTo(1)
    expect(about.y).toBeCloseTo(2)
  })

  it('ignores translation for vectors', () => {
    expect(applyToVector(translation(5, 5), vec2(1, 0))).toEqual(vec2(1, 0))
  })

  it('composes right-to-left (rightmost applied first)', () => {
    // Scale then translate: point (1,1) → scale ×2 → (2,2) → +(10,0) → (12,2).
    const t = compose(translation(10, 0), scaling(2))
    expect(applyToPoint(t, vec2(1, 1))).toEqual(vec2(12, 2))
  })

  it('reports the determinant (area scale, sign under reflection)', () => {
    expect(determinant(scaling(2, 3))).toBeCloseTo(6)
    expect(determinant(scaling(-1, 1))).toBeCloseTo(-1)
  })

  it('inverts a transform, round-tripping any point', () => {
    const t = compose(translation(10, -4), rotation(0.7), scaling(2, 3))
    const p = vec2(3, 5)
    const back = applyToPoint(invert(t), applyToPoint(t, p))
    expect(distance(back, p)).toBeLessThan(1e-12)
    expect(invert(IDENTITY)).toEqual(IDENTITY)
    // An isometry's inverse is exact enough to reproduce the point to the last few bits — F-052
    // folds a snapped replica point back to source through one of these.
    const iso = compose(translation(-30, 12), rotation(-1.1, vec2(4, 4)))
    const round = applyToPoint(invert(iso), applyToPoint(iso, p))
    expect(distance(round, p)).toBeLessThan(1e-12)
  })

  it('refuses to invert a singular transform', () => {
    expect(() => invert(scaling(0, 1))).toThrow(/singular/)
  })
})

describe('transformShape', () => {
  const t = compose(translation(3, 4), rotation(Math.PI / 6), scaling(2))

  it('transforms lines, cubics, polylines and polygons vertexwise', () => {
    const l = transformShape(t, line(vec2(1, 0), vec2(0, 1)))
    expect(l.kind).toBe('line')
    const c = transformShape(t, cubic(vec2(0, 0), vec2(1, 0), vec2(1, 1), vec2(0, 1)))
    expect(c.kind).toBe('cubic')
    const pl = transformShape(t, polyline([vec2(0, 0), vec2(1, 1)]))
    expect(pl.kind).toBe('polyline')
    const pg = transformShape(
      t,
      polygon(
        [vec2(0, 0), vec2(1, 0), vec2(0, 1)],
        [[vec2(0.2, 0.2), vec2(0.4, 0.2), vec2(0.2, 0.4)]],
      ),
    )
    expect(pg.kind).toBe('polygon')
  })

  it('keeps a circular arc circular under a similarity, scaling its radius', () => {
    const a = arc(vec2(0, 0), 5, 0, Math.PI / 2, true)
    const out = transformCurve(compose(translation(10, 0), scaling(2)), a)
    expect(out.kind).toBe('arc')
    if (out.kind === 'arc') {
      expect(out.radius).toBeCloseTo(10)
      expect(out.center.x).toBeCloseTo(10)
    }
  })

  it('rejects a non-uniform scale on an arc (would make it elliptical)', () => {
    expect(() => transformShape(scaling(2, 3), arc(vec2(0, 0), 5, 0, 1, true))).toThrow(
      /elliptical/,
    )
  })

  it('rejects reflecting an arc', () => {
    expect(() => transformShape(scaling(-1, 1), arc(vec2(0, 0), 5, 0, 1, true))).toThrow(/reflect/)
  })

  it('a rotation of an arc endpoint matches rotating the point directly', () => {
    const a = arc(vec2(0, 0), 5, 0, Math.PI / 2, true)
    const t2 = rotation(Math.PI / 3)
    const out = transformCurve(t2, a)
    // arc start (5,0) rotated by 60° should equal the transformed arc's start.
    const rotatedStart = applyToPoint(t2, vec2(5, 0))
    if (out.kind === 'arc') {
      const start = vec2(
        out.center.x + Math.cos(out.startAngle) * out.radius,
        out.center.y + Math.sin(out.startAngle) * out.radius,
      )
      expect(distance(start, rotatedStart)).toBeLessThan(1e-9)
    }
  })
})
