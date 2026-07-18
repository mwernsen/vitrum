import { arc, cubic, line, vec2 } from '@vitrum/geometry'
import type { Vec2 } from '@vitrum/geometry'
import fc from 'fast-check'

import { synthesizeNodes } from './nodes'
import { createEmptyProject } from './types'
import type { NodeId, Project, ProjectSettings, SegmentGeometry, SegmentRole } from './types'

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

/**
 * A whole project with a handful of random segments and settings. Endpoint nodes are
 * synthesised by coincidence-welding (the same rule the v1→v2 migration uses), so the
 * project satisfies the node invariants — `nodes` holds exactly the referenced ids and each
 * node position matches its geometry endpoint.
 */
export const projectArb: fc.Arbitrary<Project> = fc
  .tuple(settingsArb, fc.array(fc.tuple(geometryArb, roleArb), { maxLength: 12 }))
  .map(([settings, segs]) => {
    const base = createEmptyProject(settings)
    let counter = 0
    const mint = (): NodeId => `node-${counter++}`
    const { segments, nodes } = synthesizeNodes(
      segs.map(([geometry, role], i) => ({ id: `seg-${i}`, geometry, role })),
      mint,
    )
    return { ...base, segments, nodes }
  })

/**
 * A deliberately *welded* network for FR-1: a random set of node positions plus segments
 * (lines and cubics) whose endpoints are placed **exactly** on those node positions, so
 * distinct segments genuinely share nodes. This is the structure the junction-integrity
 * property test edits — moving/splitting/merging/mirroring must never separate two endpoints
 * that share a node.
 */
export const weldedProjectArb: fc.Arbitrary<Project> = fc
  .array(vec2Arb, { minLength: 2, maxLength: 8 })
  .chain((positions) =>
    fc
      .array(
        fc.record({
          i: fc.nat({ max: positions.length - 1 }),
          j: fc.nat({ max: positions.length - 1 }),
          curved: fc.boolean(),
          h1: vec2Arb,
          h2: vec2Arb,
          role: roleArb,
        }),
        { minLength: 1, maxLength: 12 },
      )
      .map((edges) => {
        const base = createEmptyProject()
        const nodeIds = positions.map((_, k) => `node-${k}`)
        const nodes: Project['nodes'] = Object.fromEntries(
          positions.map((pos, k) => [nodeIds[k]!, { pos }]),
        )
        const segments: Record<string, Project['segments'][string]> = {}
        edges.forEach((e, k) => {
          const i = e.i
          const j = e.i === e.j ? (e.j + 1) % positions.length : e.j
          const a = positions[i]!
          const b = positions[j]!
          const geometry: SegmentGeometry = e.curved ? cubic(a, e.h1, e.h2, b) : line(a, b)
          const id = `seg-${k}`
          segments[id] = { id, geometry, role: e.role, endpoints: [nodeIds[i]!, nodeIds[j]!] }
        })
        // Drop nodes no edge referenced so the invariant (no orphans) holds up front.
        const used = new Set<string>()
        for (const s of Object.values(segments)) {
          used.add(s.endpoints[0])
          used.add(s.endpoints[1])
        }
        const prunedNodes = Object.fromEntries(Object.entries(nodes).filter(([id]) => used.has(id)))
        return { ...base, segments, nodes: prunedNodes }
      }),
  )
