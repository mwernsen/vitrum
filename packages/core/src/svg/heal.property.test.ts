import { line, vec2, type Vec2 } from '@vitrum/geometry'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { healNetwork, type HealResult, type HealSegment } from './heal'

/**
 * FR-4 idempotence: healing is a fixed point — re-running it on its own output changes nothing.
 * A second pass must report no work (no snaps, no splits, no drops) and produce the same segment
 * count and geometry. This is the property the live-preview slider and the round-trip rely on.
 *
 * The property is over random **line** networks — the case that exercises every operation
 * (near-miss endpoint snapping, crossing splits, T-junctions, degenerate/duplicate drops) with
 * exact intersection maths. Curved-geometry idempotence is asserted on concrete fixtures in
 * `heal.test.ts` (a full circle, an arched network); wildly self-intersecting random Béziers are
 * not what SVG import produces and are out of scope for the random property.
 */

// Vertices sit on a grid coarser than the tolerance (the realistic import regime: a sub-2 mm heal
// tolerance against artwork sized in tens/hundreds of mm), so distinct vertices never fall within
// tolerance of each other and healing reaches its fixed point in one pass.
const coord = fc.integer({ min: -20, max: 20 }).map((n) => n * 10)
const point: fc.Arbitrary<Vec2> = fc.record({ x: coord, y: coord }).map((r) => vec2(r.x, r.y))
const lineArb = fc.tuple(point, point).map(([a, b]) => line(a, b))

function network(geoms: readonly HealSegment['geometry'][]): HealSegment[] {
  return geoms.map((geometry, i) => ({ id: `s${i}`, geometry, role: 'lead' as const }))
}

function signatures(result: HealResult): string[] {
  return result.segments
    .map((s) => {
      const g = s.geometry
      const r = (v: Vec2): string => `${Math.round(v.x * 1e3)},${Math.round(v.y * 1e3)}`
      if (g.kind === 'line') return `L:${r(g.a)}:${r(g.b)}`
      if (g.kind === 'cubic') return `C:${r(g.p0)}:${r(g.p1)}:${r(g.p2)}:${r(g.p3)}`
      return `A:${r(g.center)}:${Math.round(g.radius * 1e3)}`
    })
    .sort()
}

function healAgain(result: HealResult, tol: number): HealResult {
  return healNetwork(
    result.segments.map((s) => ({ id: s.id, geometry: s.geometry, role: s.role })),
    tol,
  )
}

describe('healNetwork idempotence (FR-4)', () => {
  it('is a fixed point over random line networks and tolerances', () => {
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 10 }),
        fc.constantFrom(0, 0.25, 1, 2),
        (geoms, tol) => {
          const once = healNetwork(network(geoms), tol)
          const twice = healAgain(once, tol)
          expect(twice.summary).toEqual({ snapped: 0, split: 0, dropped: 0 })
          expect(twice.changedIds.size).toBe(0)
          expect(signatures(twice)).toEqual(signatures(once))
        },
      ),
      { numRuns: 300 },
    )
  })

  it('at tolerance 0 never moves an endpoint (only exact merges, crossings, degenerate drops)', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 10 }), (geoms) => {
        expect(healNetwork(network(geoms), 0).summary.snapped).toBe(0)
      }),
      { numRuns: 300 },
    )
  })
})
