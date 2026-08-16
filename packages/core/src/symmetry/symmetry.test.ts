import {
  applyToPoint,
  arc,
  closestPoint,
  cubic,
  distance,
  line,
  pointAt,
  vec2,
  type Vec2,
} from '@vitrum/geometry'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { detectPieces } from '../pieces/detect'
import { buildSnapScene, resolveSnap } from '../snap/snap'
import { DEFAULT_SNAP_SETTINGS } from '../snap/types'

import { canonicalizeToSource, canonicalizeToSourceSector, sectorFrame } from './canonicalize'
import { expandNetwork, expandReplicas, SELF_IMAGE_TOLERANCE } from './expand'
import { geometryEnds, radialCount, symmetryTransforms, transformSymGeometry } from './transform'
import type { NetworkSegment, SymmetrySetup } from './types'

const CENTER = vec2(100, 100)

function setup(over: Partial<SymmetrySetup>): SymmetrySetup {
  return { mode: 'none', center: CENTER, angle: Math.PI / 2, count: 6, mirror: false, ...over }
}

function seg(id: string, geometry: NetworkSegment['geometry']): NetworkSegment {
  return { id, geometry, role: 'lead', endpoints: [`${id}a`, `${id}b`] }
}

/** Sample a segment geometry at a few parameters, for geometry-equivalence assertions. */
function sample(g: NetworkSegment['geometry']): Vec2[] {
  return [0, 0.25, 0.5, 0.75, 1].map((t) => pointAt(g, t))
}

describe('symmetryTransforms — multiplicity (FR-1)', () => {
  it('produces the right number of group elements per mode', () => {
    expect(symmetryTransforms(setup({ mode: 'none' }))).toHaveLength(1)
    expect(symmetryTransforms(setup({ mode: 'mirror' }))).toHaveLength(2)
    expect(symmetryTransforms(setup({ mode: 'double-mirror' }))).toHaveLength(4)
    expect(symmetryTransforms(setup({ mode: 'radial', count: 6 }))).toHaveLength(6)
    expect(symmetryTransforms(setup({ mode: 'radial', count: 6, mirror: true }))).toHaveLength(12)
  })

  it('clamps the radial count to an integer ≥ 2', () => {
    expect(radialCount(setup({ count: 1 }))).toBe(2)
    expect(radialCount(setup({ count: 5.9 }))).toBe(5)
  })
})

describe('expandReplicas — multiplicity + rigidity', () => {
  // In **general position** — the source is not fixed by any non-identity group element. Geometry
  // sitting on an axis or other fixed line has a shorter orbit and so fewer replicas; that stated
  // exception is exercised in "geometry fixed by the group" below.
  const source = [seg('L1', line(vec2(120, 100), vec2(140, 130)))]

  it('yields (elements − 1) × source replicas', () => {
    expect(expandReplicas(source, setup({ mode: 'none' }))).toHaveLength(0)
    expect(expandReplicas(source, setup({ mode: 'mirror' }))).toHaveLength(1)
    expect(expandReplicas(source, setup({ mode: 'double-mirror' }))).toHaveLength(3)
    expect(expandReplicas(source, setup({ mode: 'radial', count: 6 }))).toHaveLength(5)
    expect(expandReplicas(source, setup({ mode: 'radial', count: 6, mirror: true }))).toHaveLength(
      11,
    )
  })

  it('gives replicas deterministic, derived, welded ids', () => {
    const [r] = expandReplicas(source, setup({ mode: 'mirror' }))
    expect(r!.id).toBe('L1~sym1')
    expect(r!.endpoints).toEqual(['L1a~sym1', 'L1b~sym1'])
    // Two source segments sharing a node share a replica node (per-sector weld by construction).
    const shared: NetworkSegment[] = [
      {
        id: 'A',
        geometry: line(vec2(120, 100), vec2(140, 100)),
        role: 'lead',
        endpoints: ['n0', 'n1'],
      },
      {
        id: 'B',
        geometry: line(vec2(140, 100), vec2(160, 120)),
        role: 'lead',
        endpoints: ['n1', 'n2'],
      },
    ]
    const reps = expandReplicas(shared, setup({ mode: 'radial', count: 4 }))
    const a1 = reps.find((s) => s.id === 'A~sym1')!
    const b1 = reps.find((s) => s.id === 'B~sym1')!
    expect(a1.endpoints[1]).toBe(b1.endpoints[0]) // both 'n1~sym1'
  })

  it('is independent of input order and stable across runs', () => {
    const a = expandReplicas(source, setup({ mode: 'radial', count: 5, mirror: true }))
    const b = expandReplicas([...source], setup({ mode: 'radial', count: 5, mirror: true }))
    expect(b).toEqual(a)
  })
})

describe('transformSymGeometry — arcs stay arcs (FR-3)', () => {
  it('keeps a reflected arc a circular arc with flipped winding', () => {
    const s = setup({ mode: 'mirror', angle: Math.PI / 2 }) // vertical axis through CENTER
    const a = arc(vec2(120, 100), 15, 0, Math.PI / 2, true)
    const [t] = symmetryTransforms(s).slice(1)
    const r = transformSymGeometry(t!, a)
    expect(r.kind).toBe('arc')
    if (r.kind === 'arc') {
      expect(r.ccw).toBe(false)
      expect(r.radius).toBeCloseTo(15, 9)
      // Reflected across x = 100: center x 120 → 80.
      expect(r.center.x).toBeCloseTo(80, 9)
      expect(r.center.y).toBeCloseTo(100, 9)
    }
  })

  it('reproduces the reflected endpoints exactly', () => {
    const s = setup({ mode: 'mirror', angle: Math.PI / 2 })
    const a = arc(vec2(120, 100), 15, 0.3, 2.1, true)
    const t = symmetryTransforms(s)[1]!
    const r = transformSymGeometry(t, a)
    const [as, ae] = geometryEnds(a)
    const [rs, re] = geometryEnds(r)
    // Endpoints reflect across x = 100.
    expect(rs.x).toBeCloseTo(200 - as.x, 6)
    expect(re.x).toBeCloseTo(200 - ae.x, 6)
    expect(rs.y).toBeCloseTo(as.y, 6)
    expect(re.y).toBeCloseTo(ae.y, 6)
  })
})

describe('canonicalizeToSource — pointer confinement (FR-5)', () => {
  it('is the identity when symmetry is off', () => {
    const p = vec2(37, 42)
    expect(canonicalizeToSource(p, setup({ mode: 'none' }))).toEqual(p)
  })

  it('leaves a source-side point unchanged and folds a replica-side point (mirror)', () => {
    const s = setup({ mode: 'mirror', angle: Math.PI / 2 }) // axis x = 100
    // Axis direction (0,1); side = -sin(a)*rx + cos(a)*ry... source side is x ≤ 100 here.
    const src = canonicalizeToSource(vec2(80, 130), s)
    expect(src).toEqual(vec2(80, 130))
    const folded = canonicalizeToSource(vec2(140, 130), s)
    expect(folded.x).toBeCloseTo(60, 9)
    expect(folded.y).toBeCloseTo(130, 9)
  })

  it('folds any radial point into the first wedge', () => {
    const n = 6
    const s = setup({ mode: 'radial', count: n, angle: 0 })
    const wedge = (2 * Math.PI) / n
    for (let deg = 0; deg < 360; deg += 17) {
      const rad = (deg * Math.PI) / 180
      const p = vec2(CENTER.x + 40 * Math.cos(rad), CENTER.y + 40 * Math.sin(rad))
      const c = canonicalizeToSource(p, s)
      const rel = Math.atan2(c.y - CENTER.y, c.x - CENTER.x)
      const within = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      expect(within).toBeGreaterThanOrEqual(-1e-9)
      expect(within).toBeLessThanOrEqual(wedge + 1e-9)
      // Radius is preserved (rigid fold).
      expect(distance(c, CENTER)).toBeCloseTo(40, 9)
    }
  })

  it('folds a radial-mirror point into the half-wedge', () => {
    const n = 6
    const s = setup({ mode: 'radial', count: n, angle: 0, mirror: true })
    const half = Math.PI / n
    for (let deg = 0; deg < 360; deg += 13) {
      const rad = (deg * Math.PI) / 180
      const p = vec2(CENTER.x + 40 * Math.cos(rad), CENTER.y + 40 * Math.sin(rad))
      const c = canonicalizeToSource(p, s)
      const rel = Math.atan2(c.y - CENTER.y, c.x - CENTER.x)
      const within = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      expect(within).toBeLessThanOrEqual(half + 1e-9)
    }
  })
})

describe('expandNetwork — geometry equivalence + seam coincidence (FR-2/FR-3)', () => {
  it('replica geometry equals the source geometry pushed through the transform', () => {
    const s = setup({ mode: 'radial', count: 4, angle: 0 })
    const source = [seg('C', cubic(vec2(120, 100), vec2(130, 90), vec2(140, 110), vec2(150, 100)))]
    const transforms = symmetryTransforms(s)
    const replicas = expandReplicas(source, s)
    // replica k-1 uses transform k.
    for (let k = 1; k < transforms.length; k++) {
      const rep = replicas[k - 1]!
      const expected = transformSymGeometry(transforms[k]!, source[0]!.geometry)
      const a = sample(rep.geometry)
      const b = sample(expected)
      for (let i = 0; i < a.length; i++) expect(distance(a[i]!, b[i]!)).toBeLessThan(1e-9)
    }
  })

  it('detection sees one coherent network with no near-miss at the seams (FR-2)', () => {
    // One wedge of a 4-fold rosette: a spoke from the center out to A, plus a chord A→B. Under
    // 4-fold rotation the spokes and chords tile a closed quad with four triangular pieces; the
    // spokes must coincide at each seam for detection to weld them.
    const c = vec2(0, 0)
    const a = vec2(100, 0)
    const b = vec2(0, 100)
    const source: NetworkSegment[] = [
      { id: 'spoke', geometry: line(c, a), role: 'lead', endpoints: ['c', 'a'] },
      { id: 'chord', geometry: line(a, b), role: 'lead', endpoints: ['a', 'b'] },
    ]
    const net = expandNetwork(source, setup({ mode: 'radial', count: 4, angle: 0, center: c }))
    const { pieces, diagnostics } = detectPieces(net)
    expect(pieces).toHaveLength(4)
    expect(diagnostics.filter((d) => d.kind === 'near-miss')).toHaveLength(0)
  })

  it('makes on-axis source endpoints coincide with every sector image (seam weld, FR-2)', () => {
    // A line from the center outward along the axis: its inner endpoint is the fixed center.
    const s = setup({ mode: 'radial', count: 6, angle: 0, mirror: true })
    const source = [seg('spoke', line(CENTER, vec2(160, 100)))]
    const net = expandNetwork(source, s)
    for (const segment of net) {
      const [inner] = geometryEnds(segment.geometry)
      expect(distance(inner, CENTER)).toBeLessThan(1e-9)
    }
  })
})

/**
 * Geometry **fixed by a group element** — a border running along a mirror axis, a diameter through
 * a rotation centre — is left where it is by that element, so a naive expansion mints a second,
 * coincident copy of it. Detection cannot survive that: two half-edges leave the same vertex at the
 * same angle, the sweep pairs each with the other's twin, every traced cycle collapses to zero
 * signed area, and the design yields **no pieces at all** (user-test run 2026-08-16-a, recorded as
 * an F-052 follow-up and fixed 2026-08-16). These pin the fix — and, just as importantly, pin the
 * cases where a replica must be *kept*.
 */
describe('expandReplicas — geometry fixed by the group is not duplicated', () => {
  const AXIS_X = 0
  /** A vertical mirror axis through x = 0. */
  const vertical = setup({ mode: 'mirror', angle: Math.PI / 2, center: vec2(AXIS_X, 0) })

  /** A closed polygon as welded network segments (consecutive spans share a node id). */
  function closedPoly(prefix: string, points: readonly Vec2[]): NetworkSegment[] {
    return points.map((p, i) => ({
      id: `${prefix}${i}`,
      geometry: line(p, points[(i + 1) % points.length]!),
      role: 'lead' as const,
      endpoints: [`${prefix}n${i}`, `${prefix}n${(i + 1) % points.length}`] as const,
    }))
  }

  function detect(source: readonly NetworkSegment[], s: SymmetrySetup) {
    const net = expandNetwork(source, s)
    const { pieces, diagnostics } = detectPieces(net)
    return {
      net,
      pieces: pieces.length,
      duplicates: diagnostics.filter((d) => d.kind === 'duplicate-segment').length,
      nearMisses: diagnostics.filter((d) => d.kind === 'near-miss').length,
    }
  }

  /**
   * An independent "same path, same extent" check for the properties below — deliberately sampled
   * at different parameters than the production suppression, so the properties test the outcome
   * rather than re-running the implementation.
   */
  function samePath(a: NetworkSegment, b: NetworkSegment, tol: number): boolean {
    const along = (x: NetworkSegment, y: NetworkSegment): boolean =>
      [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].every(
        (t) => closestPoint(y.geometry, pointAt(x.geometry, t)).distance <= tol + 1e-9,
      )
    return along(a, b) && along(b, a)
  }

  it('finds the pieces of a border whose seam runs along the mirror axis', () => {
    // The reported case: half the design is drawn in the source sector and its right-hand border
    // lies *on* the axis, so that one segment is its own mirror image. Expected: two pieces (the
    // drawn half plus its reflection), welded along the seam.
    const source = closedPoly('b', [
      vec2(-80, 0),
      vec2(AXIS_X, 0),
      vec2(AXIS_X, 120),
      vec2(-80, 120),
    ])
    const { net, pieces, duplicates } = detect(source, vertical)
    expect(pieces).toBe(2)
    expect(duplicates).toBe(0)
    // The on-axis segment (b1, from (0,0) to (0,120)) contributes no replica; the other three do.
    expect(net.map((s) => s.id)).not.toContain('b1~sym1')
    expect(net).toHaveLength(7)
  })

  it('finds the piece of a closed shape symmetric about the axis', () => {
    // Every side is mapped onto a side, so all four replicas are suppressed and the shape is
    // exactly itself. Pre-fix this returned 0 pieces and 4 `duplicate-segment` diagnostics.
    const source = closedPoly('b', [vec2(-50, 0), vec2(50, 0), vec2(50, 100), vec2(-50, 100)])
    const { net, pieces, duplicates } = detect(source, vertical)
    expect(pieces).toBe(1)
    expect(duplicates).toBe(0)
    expect(net).toHaveLength(4) // the source alone
  })

  it('suppresses a near-image, not just a pointwise-identical one', () => {
    // Suppression is tolerance-based at F-020's weld tolerance, not exact: a shape drawn a hair off
    // the axis reflects to a copy the detector cannot tell apart from the source, and degenerates
    // the same way. Includes exactly half the tolerance — the decisive case, where the source and
    // its image are `weld` apart.
    for (const off of [0.001, 0.004, SELF_IMAGE_TOLERANCE / 2]) {
      const source = closedPoly('b', [
        vec2(-50 + off, 0),
        vec2(50 + off, 0),
        vec2(50 + off, 100),
        vec2(-50 + off, 100),
      ])
      const { pieces, duplicates, net } = detect(source, vertical)
      expect({ off, pieces, duplicates, segments: net.length }).toEqual({
        off,
        pieces: 1,
        duplicates: 0,
        segments: 4,
      })
    }
  })

  it('keeps both copies once detection can tell them apart', () => {
    // Past the weld tolerance the two copies are genuinely distinct geometry: detection does not
    // weld their endpoints, so nothing degenerates, and F-020's near-miss rule is the right place
    // to complain. Suppressing here would silently delete a replica the user can see.
    const off = 0.006 // source and image 0.012 mm apart — beyond the 0.01 mm weld
    const source = closedPoly('b', [
      vec2(-50 + off, 0),
      vec2(50 + off, 0),
      vec2(50 + off, 100),
      vec2(-50 + off, 100),
    ])
    const { net, pieces, nearMisses } = detect(source, vertical)
    expect(net).toHaveLength(8) // every replica kept
    expect(pieces).toBeGreaterThan(0)
    expect(nearMisses).toBeGreaterThan(0)
  })

  it('keeps the replica of a segment with only one endpoint on the axis', () => {
    // A shared endpoint is not a fixed segment: the two spans leave the axis in different
    // directions, so both must survive. Apex on the axis → the shape and its mirror, two pieces.
    const source = closedPoly('t', [vec2(AXIS_X, 0), vec2(60, 30), vec2(30, 80)])
    const { net, pieces, duplicates } = detect(source, vertical)
    expect(net).toHaveLength(6)
    expect(pieces).toBe(2)
    expect(duplicates).toBe(0)
  })

  it('keeps the replicas of a shape that crosses the axis asymmetrically', () => {
    const source = closedPoly('x', [vec2(-20, 0), vec2(50, 10), vec2(40, 70), vec2(-30, 50)])
    const { net, duplicates } = detect(source, vertical)
    expect(net).toHaveLength(8)
    expect(duplicates).toBe(0)
  })

  it('keeps a replica that only partially overlaps its source', () => {
    // A chord crossing the axis off-centre: its image runs along the same line but over a different
    // extent, so it is a genuine second segment. Containment has to hold *both* ways to suppress.
    const source = [seg('c', line(vec2(-30, 40), vec2(50, 40)))]
    const net = expandNetwork(source, vertical)
    expect(net).toHaveLength(2)
    expect(samePath(net[0]!, net[1]!, SELF_IMAGE_TOLERANCE)).toBe(false)
  })

  it('collapses a diameter through the centre under even-fold radial symmetry', () => {
    // Rotating a full diameter by π maps it onto itself, and the 90°/270° images coincide with each
    // other — so 4-fold symmetry of a diameter is two crossed diameters, not four stacked ones.
    const s = setup({ mode: 'radial', count: 4, angle: 0, center: vec2(0, 0) })
    const replicas = expandReplicas([seg('d', line(vec2(-50, 0), vec2(50, 0)))], s)
    expect(replicas.map((r) => r.id)).toEqual(['d~sym1'])
  })

  it('collapses a spoke lying on the mirror axis under radial + mirror', () => {
    // D₆ acting on a spoke that lies along the mirror axis gives 6 spokes, not 12.
    const s = setup({ mode: 'radial', count: 6, angle: 0, mirror: true, center: vec2(0, 0) })
    const net = expandNetwork([seg('sp', line(vec2(0, 0), vec2(60, 0)))], s)
    expect(net).toHaveLength(6)
  })

  it('keeps every replica of a wedge that only touches the centre', () => {
    // The radial control: a wedge fixed by nothing still tiles the full rosette.
    const s = setup({ mode: 'radial', count: 6, angle: 0, center: vec2(0, 0) })
    const { net, pieces, duplicates } = detect(
      closedPoly('w', [vec2(0, 0), vec2(60, 0), vec2(52, 30)]),
      s,
    )
    expect(net).toHaveLength(18)
    expect(pieces).toBe(6)
    expect(duplicates).toBe(0)
  })

  it('finds the piece of a box centred on the radial centre', () => {
    // Fixed by the π rotation *and* by the 90° pair, so the whole shape is its own orbit.
    const s = setup({ mode: 'radial', count: 4, angle: 0, center: vec2(0, 0) })
    const source = closedPoly('b', [vec2(-50, -50), vec2(50, -50), vec2(50, 50), vec2(-50, 50)])
    const { net, pieces } = detect(source, s)
    expect(net).toHaveLength(4)
    expect(pieces).toBe(1)
  })

  /**
   * Properties over networks deliberately biased towards fixed geometry: a lattice centred on the
   * symmetry centre and axis angles that are multiples of 45°, so on-axis and through-centre
   * segments come up often rather than never.
   */
  const arbSetup = fc
    .record({
      mode: fc.constantFrom('mirror' as const, 'double-mirror' as const, 'radial' as const),
      angleDeg: fc.constantFrom(0, 45, 90, 135, 30),
      count: fc.integer({ min: 2, max: 6 }),
      mirror: fc.boolean(),
    })
    .map((r): SymmetrySetup => ({
      mode: r.mode,
      center: vec2(0, 0),
      angle: (r.angleDeg * Math.PI) / 180,
      count: r.count,
      mirror: r.mirror,
    }))

  const arbSource = fc
    .uniqueArray(
      fc.record({
        ax: fc.integer({ min: -3, max: 3 }),
        ay: fc.integer({ min: -3, max: 3 }),
        bx: fc.integer({ min: -3, max: 3 }),
        by: fc.integer({ min: -3, max: 3 }),
      }),
      { minLength: 1, maxLength: 4, selector: (r) => JSON.stringify(r) },
    )
    .map((rs) => rs.filter((r) => r.ax !== r.bx || r.ay !== r.by))
    .filter((rs) => rs.length > 0)
    .map((rs) =>
      rs.map((r, i) => seg(`L${i}`, line(vec2(r.ax * 20, r.ay * 20), vec2(r.bx * 20, r.by * 20)))),
    )

  it('leaves no full duplicate anywhere in the expanded network', () => {
    fc.assert(
      fc.property(arbSetup, arbSource, (s, source) => {
        // Skip sources that already duplicate themselves — expansion is not asked to fix those.
        for (let i = 0; i < source.length; i++) {
          for (let j = i + 1; j < source.length; j++) {
            fc.pre(!samePath(source[i]!, source[j]!, SELF_IMAGE_TOLERANCE))
          }
        }
        const net = expandNetwork(source, s)
        for (let i = 0; i < net.length; i++) {
          for (let j = i + 1; j < net.length; j++) {
            expect(samePath(net[i]!, net[j]!, SELF_IMAGE_TOLERANCE)).toBe(false)
          }
        }
      }),
      { numRuns: 300 },
    )
  })

  it('loses no geometry: every group image still lies on the expanded network', () => {
    // The safety half of suppression. A dropped replica must be redundant, never missing: pushing
    // any source segment through any group element has to land on a segment that is still there.
    fc.assert(
      fc.property(arbSetup, arbSource, (s, source) => {
        const net = expandNetwork(source, s)
        for (const t of symmetryTransforms(s)) {
          for (const src of source) {
            const image = seg('image', transformSymGeometry(t, src.geometry))
            expect(net.some((n) => samePath(image, n, SELF_IMAGE_TOLERANCE))).toBe(true)
          }
        }
      }),
      { numRuns: 300 },
    )
  })

  it('stays independent of source order with suppression in play', () => {
    fc.assert(
      fc.property(arbSetup, arbSource, (s, source) => {
        const forward = expandReplicas(source, s)
          .map((r) => r.id)
          .sort()
        const reversed = expandReplicas([...source].reverse(), s)
          .map((r) => r.id)
          .sort()
        expect(reversed).toEqual(forward)
      }),
      { numRuns: 300 },
    )
  })
})

/**
 * The sector seam behind "snap where the cursor is, fold the winner back" (the 2026-08-16-a
 * snapping finding). Folding first made angle snap measure a reflected point; these prove the
 * sector index is right for every mode and that the fold back out of a sector is exact.
 */
describe('canonicalizeToSourceSector — sector index + frame', () => {
  const arbSetup = fc
    .record({
      mode: fc.constantFrom('mirror' as const, 'double-mirror' as const, 'radial' as const),
      cx: fc.integer({ min: -200, max: 200 }),
      cy: fc.integer({ min: -200, max: 200 }),
      angleDeg: fc.integer({ min: 0, max: 359 }),
      count: fc.integer({ min: 2, max: 8 }),
      mirror: fc.boolean(),
    })
    .map((r): SymmetrySetup => ({
      mode: r.mode,
      center: vec2(r.cx, r.cy),
      angle: (r.angleDeg * Math.PI) / 180,
      count: r.count,
      mirror: r.mirror,
    }))

  const arbPoint = fc
    .record({ x: fc.integer({ min: -400, max: 400 }), y: fc.integer({ min: -400, max: 400 }) })
    .map((p) => vec2(p.x, p.y))

  it('reports 0 for a point already in the source domain, and the identity frame with it', () => {
    const s = setup({ mode: 'mirror', angle: Math.PI / 2 }) // source half is x ≤ 100
    const inSource = vec2(80, 130)
    const fold = canonicalizeToSourceSector(inSource, s)
    expect(fold.sector).toBe(0)
    expect(fold.point).toBe(inSource) // unchanged, by reference
    const frame = sectorFrame(s, 0)
    expect(applyToPoint(frame.toSource, inSource)).toEqual(inSource)
  })

  it('reports the sector whose group element carries the folded point back (all modes)', () => {
    fc.assert(
      fc.property(arbSetup, arbPoint, (s, p) => {
        const { point, sector } = canonicalizeToSourceSector(p, s)
        const { toSector, toSource } = sectorFrame(s, sector)
        // The sector frame places the folded point back exactly where the pointer was …
        expect(distance(applyToPoint(toSector, point), p)).toBeLessThan(1e-9)
        // … and its inverse is the fold, so the two directions agree.
        expect(distance(applyToPoint(toSource, p), point)).toBeLessThan(1e-9)
      }),
      { numRuns: 400 },
    )
  })

  it('is inert with symmetry off', () => {
    const p = vec2(37, 42)
    const fold = canonicalizeToSourceSector(p, setup({ mode: 'none' }))
    expect(fold).toEqual({ point: p, sector: 0 })
  })
})

describe('snapping in a sector folds back to the exact source point', () => {
  const arbSetup = fc
    .record({
      mode: fc.constantFrom('mirror' as const, 'double-mirror' as const, 'radial' as const),
      angleDeg: fc.integer({ min: 0, max: 359 }),
      count: fc.integer({ min: 2, max: 6 }),
      mirror: fc.boolean(),
    })
    .map((r): SymmetrySetup => ({
      mode: r.mode,
      center: CENTER,
      angle: (r.angleDeg * Math.PI) / 180,
      count: r.count,
      mirror: r.mirror,
    }))

  const arbLine = fc
    .record({
      ax: fc.integer({ min: -150, max: 150 }),
      ay: fc.integer({ min: -150, max: 150 }),
      bx: fc.integer({ min: -150, max: 150 }),
      by: fc.integer({ min: -150, max: 150 }),
    })
    .map((r) => line(vec2(r.ax, r.ay), vec2(r.bx, r.by)))

  /**
   * The ticket's exactness property (FR-5, agreed 2026-08-16): a replica is a **rigid image** of the
   * source, so snapping onto sector `k`'s copy of an endpoint and applying `k⁻¹` lands on the source
   * endpoint itself — not near it. Drives the real snap engine over the real expanded network, so it
   * is the shell's actual path minus the runes.
   */
  it('snapping onto a replica endpoint reproduces the source endpoint within 1e-9 mm', () => {
    fc.assert(
      fc.property(
        arbSetup,
        fc.array(arbLine, { minLength: 1, maxLength: 3 }),
        fc.nat(),
        fc.nat(),
        fc.nat(),
        fc.double({ min: 0, max: Math.PI * 2, noNaN: true }),
        (s, lines, segPick, endPick, sectorPick, offsetDir) => {
          const source = lines.map((g, i) => seg(`L${i}`, g))
          const transforms = symmetryTransforms(s)
          // A replica sector (never the source itself — that path is unchanged by the fix).
          const sector = 1 + (sectorPick % (transforms.length - 1))
          const target = source[segPick % source.length]!
          const ends = geometryEnds(target.geometry)
          const sourceEnd = ends[endPick % 2]!

          // Where the cursor would be: just off that endpoint's image in the chosen sector.
          const image = applyToPoint(transforms[sector]!, sourceEnd)
          const radiusMm = 2
          const cursor = vec2(
            image.x + 0.4 * Math.cos(offsetDir),
            image.y + 0.4 * Math.sin(offsetDir),
          )

          // Only meaningful when that image really is the nearest endpoint to the cursor: random
          // networks can put two endpoints (or two sectors' copies) on top of each other.
          const expanded = expandNetwork(source, s)
          const candidates = expanded.flatMap((sg) => [...geometryEnds(sg.geometry)])
          const nearest = candidates.reduce((best, c) =>
            distance(c, cursor) < distance(best, cursor) ? c : best,
          )
          fc.pre(distance(nearest, image) < 1e-9)

          const hit = resolveSnap(
            buildSnapScene(expanded.map((sg) => ({ geometry: sg.geometry }))),
            {
              world: cursor,
              radiusMm,
              gridMm: null,
              anchors: [],
              settings: { ...DEFAULT_SNAP_SETTINGS, master: true },
            },
          )
          expect(hit?.kind).toBe('endpoint')
          const back = applyToPoint(sectorFrame(s, sector).toSource, hit!.world)
          expect(distance(back, sourceEnd)).toBeLessThan(1e-9)
        },
      ),
      { numRuns: 400 },
    )
  })
})
