import { describe, expect, it } from 'vitest'

import { closestPoint, intersect, pointAt } from './index'
import { makeRng } from './rand'
import type { Curve } from './types'
import { arc, cubic, line, polyline } from './types'
import { distance, vec2 } from './vec2'

/**
 * Whether this run is instrumented for coverage, which slows the perf guard's hot loop. Read off
 * `globalThis` rather than `process.env` directly: `packages/geometry` ships no `@types/node` (it must
 * stay platform-free, and `pnpm check` type-checks test files too), so the one env read in this file
 * is narrowed here instead of dragging node types into the package.
 */
function coverageRun(): boolean {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
  return Boolean(proc?.env?.['VITEST_COVERAGE'])
}

describe('segment × segment', () => {
  it('finds a transversal crossing with parameters on both curves', () => {
    const a = line(vec2(0, 0), vec2(10, 10))
    const b = line(vec2(0, 10), vec2(10, 0))
    const hits = intersect(a, b)
    expect(hits).toHaveLength(1)
    const h = hits[0]!
    expect(h.point.x).toBeCloseTo(5)
    expect(h.point.y).toBeCloseTo(5)
    expect(h.t0).toBeCloseTo(0.5)
    expect(h.t1).toBeCloseTo(0.5)
    expect(h.tangential).toBe(false)
    expect(h.atEndpoint).toBe(false)
  })

  it('returns nothing for parallel disjoint segments', () => {
    expect(intersect(line(vec2(0, 0), vec2(10, 0)), line(vec2(0, 1), vec2(10, 1)))).toEqual([])
  })

  it('returns nothing when bounding boxes do not overlap (pre-filter)', () => {
    expect(intersect(line(vec2(0, 0), vec2(1, 1)), line(vec2(50, 50), vec2(60, 60)))).toEqual([])
  })

  it('flags an endpoint touch', () => {
    const hits = intersect(line(vec2(0, 0), vec2(5, 0)), line(vec2(5, 0), vec2(5, 5)))
    expect(hits).toHaveLength(1)
    expect(hits[0]!.atEndpoint).toBe(true)
  })

  it('reports the shared span of collinear overlapping segments', () => {
    const hits = intersect(line(vec2(0, 0), vec2(10, 0)), line(vec2(4, 0), vec2(20, 0)))
    const xs = hits.map((h) => h.point.x).sort((p, q) => p - q)
    expect(xs[0]).toBeCloseTo(4)
    expect(xs[xs.length - 1]).toBeCloseTo(10)
  })
})

describe('arc and mixed pairs', () => {
  it('intersects a segment with an arc', () => {
    const a = arc(vec2(0, 0), 5, 0, Math.PI, true) // upper semicircle
    const hits = intersect(a, line(vec2(-6, 3), vec2(6, 3)))
    expect(hits).toHaveLength(2)
    for (const h of hits) expect(distance(h.point, vec2(0, 0))).toBeCloseTo(5)
  })

  it('intersects two arcs', () => {
    const a = arc(vec2(0, 0), 5, 0, Math.PI, true)
    const b = arc(vec2(6, 0), 5, 0, Math.PI, true)
    const hits = intersect(a, b)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    for (const h of hits) {
      expect(distance(h.point, vec2(0, 0))).toBeCloseTo(5)
      expect(distance(h.point, vec2(6, 0))).toBeCloseTo(5)
    }
  })

  it('classifies a line tangent to an arc as tangential', () => {
    const a = arc(vec2(0, 0), 5, 0, Math.PI, true)
    const tangent = line(vec2(-3, 5), vec2(3, 5)) // touches the top at (0,5)
    const hits = intersect(a, tangent)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.point.x).toBeCloseTo(0)
    expect(hits[0]!.point.y).toBeCloseTo(5)
    expect(hits[0]!.tangential).toBe(true)
  })
})

describe('bézier pairs', () => {
  it('intersects a cubic with a segment, ignoring hits off the segment', () => {
    // p0 above / p3 below y=0 with a double wiggle → three interior crossings at
    // x ≈ (small), 4.5, (large); none land on an endpoint.
    const c = cubic(vec2(0, 3), vec2(3, -9), vec2(6, 9), vec2(9, -3))
    // A short segment around x=4.5 sees only the middle crossing.
    const hits = intersect(c, line(vec2(4, 0), vec2(5, 0)))
    expect(hits).toHaveLength(1)
    expect(hits[0]!.point.y).toBeCloseTo(0)
    expect(hits[0]!.point.x).toBeCloseTo(4.5)
    // The full line sees all three roots.
    expect(intersect(c, line(vec2(-1, 0), vec2(10, 0))).length).toBe(3)
  })

  it('intersects two cubics', () => {
    const a = cubic(vec2(0, 0), vec2(3, 8), vec2(6, 8), vec2(9, 0))
    const b = cubic(vec2(0, 6), vec2(3, -2), vec2(6, -2), vec2(9, 6))
    const hits = intersect(a, b)
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })

  it('intersects an arc with a cubic', () => {
    const a = arc(vec2(0, 0), 5, 0, Math.PI, true)
    const c = cubic(vec2(-6, 2), vec2(-2, 8), vec2(2, 8), vec2(6, 2))
    const hits = intersect(a, c)
    for (const h of hits) expect(distance(h.point, vec2(0, 0))).toBeCloseTo(5, 3)
  })
})

describe('polyline decomposition', () => {
  it('intersects through every segment of a polyline', () => {
    const pl = polyline([vec2(0, 0), vec2(10, 0), vec2(10, 10)])
    const hits = intersect(pl, line(vec2(5, -5), vec2(5, 5)))
    expect(hits).toHaveLength(1)
    expect(hits[0]!.point.x).toBeCloseTo(5)
    expect(hits[0]!.point.y).toBeCloseTo(0)
  })
})

describe('performance (FR-5)', () => {
  it('runs 10,000 random segment-pair intersections in well under 100ms', () => {
    const rng = makeRng(777)
    const pairs = Array.from({ length: 10_000 }, () => [rng.line(), rng.line()] as const)
    const t0 = Date.now()
    for (const [a, b] of pairs) intersect(a, b)
    // Budget is 100ms (FR-5); local runs land ~10ms. Under `--coverage` the V8
    // instrumentation slows this hot loop enough to breach 100ms on shared CI
    // runners (seen: 115ms), so coverage runs (`pnpm test:coverage`, which sets
    // VITEST_COVERAGE) get headroom — the real budget is still enforced by the
    // uninstrumented test step, and intersect.bench.ts measures precisely.
    const budget = coverageRun() ? 400 : 100
    expect(Date.now() - t0).toBeLessThan(budget)
  })
})

describe('intersections lie on both curves (property, FR-4)', () => {
  it('every reported point is within tolerance of both inputs', () => {
    const rng = makeRng(2024)
    const makers = [rng.line, rng.arc, rng.cubic]
    let checked = 0
    for (let i = 0; i < 600; i++) {
      const a: Curve = makers[i % 3]!()
      const b: Curve = makers[(i + 1) % 3]!()
      for (const h of intersect(a, b)) {
        expect(closestPoint(a, h.point).distance).toBeLessThan(1e-4)
        expect(closestPoint(b, h.point).distance).toBeLessThan(1e-4)
        // The reported parameters reproduce the point.
        expect(distance(pointAt(a, h.t0), h.point)).toBeLessThan(1e-3)
        expect(distance(pointAt(b, h.t1), h.point)).toBeLessThan(1e-3)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(50) // the suite actually exercised intersections
  })
})
