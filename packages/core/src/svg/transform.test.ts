import { applyToPoint, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { parseTransform } from './transform'

describe('parseTransform', () => {
  it('returns identity for a missing attribute', () => {
    const t = parseTransform(undefined)
    expect(applyToPoint(t, vec2(3, 4))).toEqual(vec2(3, 4))
  })

  it('parses translate', () => {
    const t = parseTransform('translate(10, 20)')
    expect(applyToPoint(t, vec2(1, 2))).toEqual(vec2(11, 22))
  })

  it('parses scale (single and dual)', () => {
    expect(applyToPoint(parseTransform('scale(2)'), vec2(3, 4))).toEqual(vec2(6, 8))
    expect(applyToPoint(parseTransform('scale(2 3)'), vec2(3, 4))).toEqual(vec2(6, 12))
  })

  it('parses matrix directly', () => {
    const t = parseTransform('matrix(1 0 0 1 5 6)')
    expect(applyToPoint(t, vec2(0, 0))).toEqual(vec2(5, 6))
  })

  it('composes multiple terms left-to-right (later terms apply first)', () => {
    // translate then scale: a point is scaled, then translated.
    const t = parseTransform('translate(100 0) scale(2)')
    const p = applyToPoint(t, vec2(10, 0))
    expect(p.x).toBeCloseTo(120, 9)
    expect(p.y).toBeCloseTo(0, 9)
  })

  it('parses rotate in degrees about a centre', () => {
    const t = parseTransform('rotate(90 10 10)')
    const p = applyToPoint(t, vec2(20, 10))
    expect(p.x).toBeCloseTo(10, 9)
    expect(p.y).toBeCloseTo(20, 9)
  })
})
