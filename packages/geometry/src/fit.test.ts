import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { cubicPointAt } from './cubicmath'
import { fitCubics, isNearlyStraight } from './fit'
import { cubic, type CubicBezier } from './types'
import { distance, type Vec2 } from './vec2'

/** Sample a cubic at `n+1` evenly-spaced parameters. */
function sample(c: CubicBezier, n: number): Vec2[] {
  return Array.from({ length: n + 1 }, (_, i) => cubicPointAt(c, i / n))
}

/**
 * Worst distance from each point to the fitted chain. Sampled *very* densely: at 64 samples per span
 * the sample spacing on a 150 mm curve is ~2 mm, so the metric would report a ~1 mm "error" for a
 * point sitting exactly on the curve.
 */
const CHAIN_SAMPLES = 4000

function chainError(points: readonly Vec2[], curves: readonly CubicBezier[]): number {
  const samples = curves.map((c) =>
    Array.from({ length: CHAIN_SAMPLES + 1 }, (_, i) => cubicPointAt(c, i / CHAIN_SAMPLES)),
  )
  let worst = 0
  for (const p of points) {
    let best = Infinity
    for (const run of samples) {
      for (const q of run) {
        const d = distance(p, q)
        if (d < best) best = d
      }
    }
    if (best > worst) worst = best
  }
  return worst
}

describe('fitCubics', () => {
  it('returns nothing for fewer than two distinct points', () => {
    expect(fitCubics([], 1)).toEqual([])
    expect(fitCubics([{ x: 1, y: 2 }], 1)).toEqual([])
    expect(
      fitCubics(
        [
          { x: 1, y: 2 },
          { x: 1, y: 2 },
        ],
        1,
      ),
    ).toEqual([])
  })

  it('fits a straight run with one span whose endpoints are the run ends', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i * 2, y: 5 }))
    const fitted = fitCubics(pts, 0.01)
    expect(fitted).toHaveLength(1)
    expect(fitted[0]!.p0).toEqual({ x: 0, y: 5 })
    expect(fitted[0]!.p3).toEqual({ x: 38, y: 5 })
  })

  it('recovers a single cubic from its own samples', () => {
    const source = cubic({ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 70, y: -40 }, { x: 100, y: 10 })
    const pts = sample(source, 400)
    const fitted = fitCubics(pts, 0.05)
    expect(fitted).toHaveLength(1)
    expect(chainError(pts, fitted)).toBeLessThanOrEqual(0.05)
  })

  it('holds a loose tolerance with one span even on a coarsely sampled curve', () => {
    // Coarse samples give a chord-length parameterisation several mm off the true one, so the
    // alternating fit lands near but not on the source curve. One span still holds 0.5 mm.
    const source = cubic({ x: 0, y: 0 }, { x: 30, y: 60 }, { x: 70, y: -40 }, { x: 100, y: 10 })
    const pts = sample(source, 60)
    const fitted = fitCubics(pts, 0.5)
    expect(fitted).toHaveLength(1)
    expect(chainError(pts, fitted)).toBeLessThanOrEqual(0.5)
  })

  it('fits a closed run by halving it first', () => {
    const ring = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * Math.PI * 2
      return { x: 40 * Math.cos(a), y: 40 * Math.sin(a) }
    })
    // The run closes on itself — the same point repeated last — which has no chord to fit along.
    const pts = [...ring, ring[0]!]
    const fitted = fitCubics(pts, 0.3)
    expect(fitted.length).toBeGreaterThanOrEqual(2)
    expect(chainError(pts, fitted)).toBeLessThanOrEqual(0.3)
    // The chain closes: the last span ends where the first begins.
    expect(fitted[fitted.length - 1]!.p3).toEqual(fitted[0]!.p0)
  })

  it('splits a hairpin into several spans and still holds the tolerance', () => {
    // Three quarters of a circle: no single cubic can hold a tight tolerance over it.
    const pts = Array.from({ length: 200 }, (_, i) => {
      const a = (i / 199) * Math.PI * 1.5
      return { x: 50 * Math.cos(a), y: 50 * Math.sin(a) }
    })
    const fitted = fitCubics(pts, 0.1)
    expect(fitted.length).toBeGreaterThan(1)
    expect(chainError(pts, fitted)).toBeLessThanOrEqual(0.1)
  })

  it('chains spans that share endpoints exactly', () => {
    const pts = Array.from({ length: 120 }, (_, i) => {
      const t = i / 119
      return { x: t * 200, y: 40 * Math.sin(t * Math.PI * 3) }
    })
    const fitted = fitCubics(pts, 0.05)
    expect(fitted.length).toBeGreaterThan(1)
    for (let i = 1; i < fitted.length; i++) {
      expect(fitted[i]!.p0).toEqual(fitted[i - 1]!.p3)
    }
    expect(fitted[0]!.p0).toEqual(pts[0])
    expect(fitted[fitted.length - 1]!.p3).toEqual(pts[pts.length - 1])
  })

  it('is deterministic (F-059 FR-6)', () => {
    const pts = sample(
      cubic({ x: 0, y: 0 }, { x: 5, y: 90 }, { x: 95, y: -20 }, { x: 100, y: 0 }),
      80,
    )
    expect(fitCubics(pts, 0.2)).toEqual(fitCubics(pts, 0.2))
  })

  it('holds the tolerance on arbitrary sampled cubics (property)', () => {
    const coord = fc.integer({ min: -100, max: 100 })
    const point = fc.record({ x: coord, y: coord })
    fc.assert(
      fc.property(point, point, point, point, (p0, p1, p2, p3) => {
        // A cubic whose endpoints coincide has no chord to fit along; skip that degenerate case.
        fc.pre(distance(p0, p3) > 1)
        const source = cubic(p0, p1, p2, p3)
        const pts = sample(source, 40)
        const tol = 0.5
        const fitted = fitCubics(pts, tol)
        expect(fitted.length).toBeGreaterThanOrEqual(1)
        // Endpoints are preserved exactly, and every sample is within tolerance of the chain.
        expect(fitted[0]!.p0).toEqual(pts[0])
        expect(fitted[fitted.length - 1]!.p3).toEqual(pts[pts.length - 1])
        expect(chainError(pts, fitted)).toBeLessThanOrEqual(tol + 1e-6)
      }),
      { numRuns: 60 },
    )
  })

  it('rejects a negative tolerance', () => {
    expect(() => fitCubics([{ x: 0, y: 0 }], -1)).toThrow(/tolerance/)
  })
})

describe('isNearlyStraight', () => {
  it('accepts a straight run and rejects a bowed one', () => {
    const straight = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 2 * i }))
    expect(isNearlyStraight(straight, 1e-9)).toBe(true)
    const bowed = [
      { x: 0, y: 0 },
      { x: 5, y: 3 },
      { x: 10, y: 0 },
    ]
    expect(isNearlyStraight(bowed, 1)).toBe(false)
    expect(isNearlyStraight(bowed, 4)).toBe(true)
  })

  it('treats a closed run as straight only when it collapses to a point', () => {
    const loop = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 0 },
    ]
    expect(isNearlyStraight(loop, 1)).toBe(false)
  })
})
