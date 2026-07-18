import { arc, cubic, line, vec2 } from '@vitrum/geometry'
import type { Vec2 } from '@vitrum/geometry'
import fc from 'fast-check'

import { createEmptyProject } from './types'
import type { Project, ProjectSettings, SegmentGeometry, SegmentRole } from './types'

/**
 * Shared fast-check generators for the property-based suites (FR-2 undo/redo exactness,
 * FR-3 lossless round-trip). Numbers are finite and normalized so they survive a JSON
 * round-trip exactly: `NaN`/`Infinity` are excluded and `-0` is folded to `0` (JSON
 * writes both as `0`), which keeps `toEqual` honest.
 */
const finite = (): fc.Arbitrary<number> =>
  fc
    .double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true })
    .map((n) => (Object.is(n, -0) ? 0 : n))

export const vec2Arb: fc.Arbitrary<Vec2> = fc
  .record({ x: finite(), y: finite() })
  .map((p) => vec2(p.x, p.y))

export const geometryArb: fc.Arbitrary<SegmentGeometry> = fc.oneof(
  fc.tuple(vec2Arb, vec2Arb).map(([a, b]) => line(a, b)),
  fc
    .record({
      center: vec2Arb,
      radius: finite().map((r) => Math.abs(r) + 1),
      start: finite(),
      end: finite(),
      ccw: fc.boolean(),
    })
    .map((a) => arc(a.center, a.radius, a.start, a.end, a.ccw)),
  fc.tuple(vec2Arb, vec2Arb, vec2Arb, vec2Arb).map(([p0, p1, p2, p3]) => cubic(p0, p1, p2, p3)),
)

export const roleArb: fc.Arbitrary<SegmentRole> = fc.constantFrom('lead', 'construction', 'border')

export const settingsArb: fc.Arbitrary<ProjectSettings> = fc
  .record({
    units: fc.constantFrom('mm', 'in') as fc.Arbitrary<'mm' | 'in'>,
    name: fc.string(),
    panelSize: fc.option(
      fc.record({ width: finite().map(Math.abs), height: finite().map(Math.abs) }),
      {
        nil: undefined,
      },
    ),
  })
  .map((s) =>
    s.panelSize
      ? { units: s.units, name: s.name, panelSize: s.panelSize }
      : { units: s.units, name: s.name },
  )

/** A whole project with a handful of random segments and settings. */
export const projectArb: fc.Arbitrary<Project> = fc
  .tuple(settingsArb, fc.array(fc.tuple(geometryArb, roleArb), { maxLength: 12 }))
  .map(([settings, segs]) => {
    const base = createEmptyProject(settings)
    const segments: Project['segments'] = Object.fromEntries(
      segs.map(([geometry, role], i) => {
        const id = `seg-${i}`
        return [id, { id, geometry, role }]
      }),
    )
    return { ...base, segments }
  })
