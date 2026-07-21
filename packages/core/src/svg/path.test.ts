import { arcPointAt, cubicPointAt, lerp, vec2, type Arc, type CubicBezier, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { arcCommand, parsePathData, type PathGeometry } from './path'

function sample(g: PathGeometry, t: number): Vec2 {
  if (g.kind === 'line') return lerp(g.a, g.b, t)
  if (g.kind === 'cubic') return cubicPointAt(g, t)
  return arcPointAt(g, t)
}

describe('parsePathData — lines', () => {
  it('parses absolute M/L into a line', () => {
    const g = parsePathData('M 0 0 L 100 40')
    expect(g).toHaveLength(1)
    expect(g[0]!.kind).toBe('line')
    expect(sample(g[0]!, 1)).toEqual(vec2(100, 40))
  })

  it('chains implicit L after M and handles relative m/l', () => {
    const g = parsePathData('M 10 10 20 0 l 0 30')
    expect(g).toHaveLength(2)
    // Second pair after M is an implicit L to (20,0) absolute.
    expect(sample(g[0]!, 1)).toEqual(vec2(20, 0))
    // Relative l 0 30 from (20,0) → (20,30).
    expect(sample(g[1]!, 1)).toEqual(vec2(20, 30))
  })

  it('handles H/V and closes with Z', () => {
    const g = parsePathData('M 0 0 H 50 V 50 H 0 Z')
    expect(g).toHaveLength(4)
    expect(sample(g[3]!, 1)).toEqual(vec2(0, 0))
  })

  it('parses tightly packed numbers (10-20)', () => {
    const g = parsePathData('M0 0L10-20')
    expect(sample(g[0]!, 1)).toEqual(vec2(10, -20))
  })
})

describe('parsePathData — béziers', () => {
  it('parses a cubic C', () => {
    const g = parsePathData('M 0 0 C 10 60 70 60 80 0')
    expect(g[0]!.kind).toBe('cubic')
    const c = g[0] as CubicBezier
    expect(c.p1).toEqual(vec2(10, 60))
    expect(c.p3).toEqual(vec2(80, 0))
  })

  it('elevates a quadratic Q to a cubic through the same points', () => {
    const g = parsePathData('M 0 0 Q 50 100 100 0')
    expect(g[0]!.kind).toBe('cubic')
    // Midpoint of a quadratic (0,0)-(50,100)-(100,0) is (50,50).
    expect(sample(g[0]!, 0.5).x).toBeCloseTo(50, 6)
    expect(sample(g[0]!, 0.5).y).toBeCloseTo(50, 6)
  })

  it('reflects the control point for a smooth S', () => {
    const g = parsePathData('M 0 0 C 0 20 20 20 20 0 S 40 -20 40 0')
    expect(g).toHaveLength(2)
    const second = g[1] as CubicBezier
    // Reflection of (20,20) about (20,0) is (20,-20).
    expect(second.p1).toEqual(vec2(20, -20))
  })
})

describe('parsePathData — arcs', () => {
  it('reconstructs a circular arc exactly as a kernel Arc', () => {
    // A quarter circle from (15,0)+center(0,0) going CCW (sweep flag 1 in y-down space).
    const g = parsePathData('M 15 0 A 15 15 0 0 1 0 15')
    expect(g).toHaveLength(1)
    expect(g[0]!.kind).toBe('arc')
    const a = g[0] as Arc
    expect(a.radius).toBeCloseTo(15, 9)
    expect(a.center.x).toBeCloseTo(0, 6)
    expect(a.center.y).toBeCloseTo(0, 6)
    expect(sample(a, 0)).toEqual(vec2(15, 0))
    expect(sample(a, 1).x).toBeCloseTo(0, 6)
    expect(sample(a, 1).y).toBeCloseTo(15, 6)
  })

  it('converts an elliptical arc to cubics that trace the ellipse', () => {
    const g = arcCommand(vec2(50, 0), vec2(0, 30), 50, 30, 0, false, true)
    expect(g.every((s) => s.kind === 'cubic')).toBe(true)
    // Sampled points lie on the ellipse x²/50² + y²/30² = 1 centred at origin.
    for (const seg of g) {
      for (let k = 0; k <= 4; k++) {
        const p = sample(seg, k / 4)
        expect((p.x * p.x) / 2500 + (p.y * p.y) / 900).toBeCloseTo(1, 3)
      }
    }
  })

  it('reads packed arc flags without separators', () => {
    const g = parsePathData('M0 0A25 25 0 0150 0')
    expect(g[0]!.kind).toBe('arc')
    expect(sample(g[0]!, 1).x).toBeCloseTo(50, 6)
  })
})
