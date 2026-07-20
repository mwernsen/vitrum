import { describe, expect, it } from 'vitest'

import { inscribedCircle } from './inscribed'
import { vec2 } from './vec2'

/**
 * The inscribed circle is F-031's inscribed-width proxy: twice the radius is the widest span of
 * glass a piece contains. These tests pin the radius (the quantity the sliver rule reads) against
 * shapes with a known analytic answer, within the search precision.
 */
describe('inscribedCircle', () => {
  it('a square of side s inscribes a circle of radius s/2 at its centre', () => {
    const s = 40
    const { center, radius } = inscribedCircle([vec2(0, 0), vec2(s, 0), vec2(s, s), vec2(0, s)])
    expect(radius).toBeCloseTo(s / 2, 1)
    expect(center.x).toBeCloseTo(s / 2, 0)
    expect(center.y).toBeCloseTo(s / 2, 0)
  })

  it('a thin rectangle inscribes a circle of radius = half the short side (its inscribed width)', () => {
    // 3 mm wide, 60 mm long → widest inscribed circle has radius 1.5 mm.
    const { radius } = inscribedCircle([vec2(0, 0), vec2(60, 0), vec2(60, 3), vec2(0, 3)], [], 0.01)
    expect(radius).toBeCloseTo(1.5, 1)
  })

  it('respects holes: the circle sits in the frame and avoids an interior hole', () => {
    // A 40 mm square with a centred 20 mm-square hole. The widest fit is tucked into a frame
    // corner, on the diagonal: radius = 10√2 / (1 + √2) ≈ 5.858 mm (bounded by the outer corner
    // and the hole's corner). The centre must land outside the hole.
    const outer = [vec2(0, 0), vec2(40, 0), vec2(40, 40), vec2(0, 40)]
    const hole = [vec2(10, 10), vec2(30, 10), vec2(30, 30), vec2(10, 30)]
    const { center, radius } = inscribedCircle(outer, [hole], 0.02)
    expect(radius).toBeCloseTo((10 * Math.SQRT2) / (1 + Math.SQRT2), 1)
    const inHole = center.x > 10 && center.x < 30 && center.y > 10 && center.y < 30
    expect(inHole).toBe(false)
  })

  it('a degenerate ring yields a zero-radius circle', () => {
    expect(inscribedCircle([vec2(0, 0), vec2(10, 0)]).radius).toBe(0)
    expect(inscribedCircle([vec2(0, 0), vec2(10, 0), vec2(20, 0)]).radius).toBeCloseTo(0, 5)
  })

  it('an equilateral triangle inscribes its incircle (r = side / (2√3))', () => {
    const side = 30
    const height = (side * Math.sqrt(3)) / 2
    const { radius } = inscribedCircle(
      [vec2(0, 0), vec2(side, 0), vec2(side / 2, height)],
      [],
      0.01,
    )
    expect(radius).toBeCloseTo(side / (2 * Math.sqrt(3)), 1)
  })
})
