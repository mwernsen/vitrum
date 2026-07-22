import { arc, cubic, distance, line, pointAt, vec2, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { detectPieces } from '../pieces/detect'

import { canonicalizeToSource } from './canonicalize'
import { expandNetwork, expandReplicas } from './expand'
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
