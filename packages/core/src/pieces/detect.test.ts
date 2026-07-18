import { arc, line, vec2, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { detectPieces, PieceDetector } from './detect'
import type { PieceSegment, PieceSegmentRole } from './types'

/** Build a lead segment between two named nodes; positions come from the node table. */
function net(
  nodes: Record<string, Vec2>,
  edges: Array<[string, string, string?, PieceSegmentRole?]>,
): PieceSegment[] {
  return edges.map(([a, b, id, role], i) => ({
    id: id ?? `s${i}`,
    geometry: line(nodes[a]!, nodes[b]!),
    role: role ?? 'lead',
    endpoints: [a, b] as const,
  }))
}

const SQUARE = {
  n0: vec2(0, 0),
  n1: vec2(100, 0),
  n2: vec2(100, 100),
  n3: vec2(0, 100),
}

describe('detectPieces — basics', () => {
  it('detects a single closed square as one piece with the right area', () => {
    const segments = net(SQUARE, [
      ['n0', 'n1'],
      ['n1', 'n2'],
      ['n2', 'n3'],
      ['n3', 'n0'],
    ])
    const { pieces, diagnostics } = detectPieces(segments)
    expect(pieces).toHaveLength(1)
    expect(pieces[0]!.area).toBeCloseTo(10000, 3)
    expect(pieces[0]!.perimeter).toBeCloseTo(400, 3)
    expect(pieces[0]!.centroid.x).toBeCloseTo(50, 3)
    expect(pieces[0]!.centroid.y).toBeCloseTo(50, 3)
    expect(diagnostics).toHaveLength(0)
  })

  it('splits a square into two triangles across a diagonal (conservation)', () => {
    const segments = net(SQUARE, [
      ['n0', 'n1'],
      ['n1', 'n2'],
      ['n2', 'n3'],
      ['n3', 'n0'],
      ['n0', 'n2', 'diag'],
    ])
    const { pieces } = detectPieces(segments)
    expect(pieces).toHaveLength(2)
    for (const p of pieces) expect(p.area).toBeCloseTo(5000, 3)
    const total = pieces.reduce((s, p) => s + p.area, 0)
    expect(total).toBeCloseTo(10000, 3)
  })

  it('detects a 2x2 grid as four equal pieces', () => {
    const nodes: Record<string, Vec2> = {}
    for (let r = 0; r <= 2; r++) {
      for (let c = 0; c <= 2; c++) nodes[`n${r}${c}`] = vec2(c * 50, r * 50)
    }
    const edges: Array<[string, string, string?]> = []
    for (let r = 0; r <= 2; r++) {
      for (let c = 0; c < 2; c++) edges.push([`n${r}${c}`, `n${r}${c + 1}`])
    }
    for (let c = 0; c <= 2; c++) {
      for (let r = 0; r < 2; r++) edges.push([`n${r}${c}`, `n${r + 1}${c}`])
    }
    const { pieces } = detectPieces(net(nodes, edges))
    expect(pieces).toHaveLength(4)
    for (const p of pieces) expect(p.area).toBeCloseTo(2500, 3)
  })

  it('traces a curved boundary (chord + arc) with true area and perimeter', () => {
    const segments: PieceSegment[] = [
      {
        id: 'chord',
        geometry: line(vec2(0, 0), vec2(100, 0)),
        role: 'lead',
        endpoints: ['a', 'b'],
      },
      {
        id: 'arc',
        geometry: arc(vec2(50, 0), 50, 0, Math.PI, true),
        role: 'lead',
        endpoints: ['b', 'a'],
      },
    ]
    const { pieces } = detectPieces(segments)
    expect(pieces).toHaveLength(1)
    // Flattened-polygon area/perimeter track the true curve within the flatten tolerance.
    const trueArea = (Math.PI * 50 * 50) / 2
    const truePerimeter = 100 + Math.PI * 50
    expect(Math.abs(pieces[0]!.area - trueArea) / trueArea).toBeLessThan(0.005)
    expect(Math.abs(pieces[0]!.perimeter - truePerimeter) / truePerimeter).toBeLessThan(0.005)
  })
})

describe('detectPieces — border and holes', () => {
  const BORDER: Array<[string, string, string?, PieceSegmentRole?]> = [
    ['n0', 'n1', 'b0', 'border'],
    ['n1', 'n2', 'b1', 'border'],
    ['n2', 'n3', 'b2', 'border'],
    ['n3', 'n0', 'b3', 'border'],
  ]

  it('drops faces that lie outside the border contour', () => {
    const nodes: Record<string, Vec2> = {
      ...SQUARE,
      // A disconnected lead triangle well outside the border square.
      t0: vec2(200, 0),
      t1: vec2(300, 0),
      t2: vec2(250, 100),
    }
    const segments = net(nodes, [
      ...BORDER,
      ['t0', 't1', 'l0'],
      ['t1', 't2', 'l1'],
      ['t2', 't0', 'l2'],
    ])
    const { pieces } = detectPieces(segments)
    expect(pieces).toHaveLength(1)
    expect(pieces[0]!.area).toBeCloseTo(10000, 3)
  })

  it('reports a disconnected island as a hole plus its own inner piece', () => {
    const nodes: Record<string, Vec2> = {
      ...SQUARE,
      m0: vec2(40, 40),
      m1: vec2(60, 40),
      m2: vec2(60, 60),
      m3: vec2(40, 60),
    }
    const segments = net(nodes, [
      ...BORDER,
      ['m0', 'm1', 'i0'],
      ['m1', 'm2', 'i1'],
      ['m2', 'm3', 'i2'],
      ['m3', 'm0', 'i3'],
    ])
    const { pieces } = detectPieces(segments)
    expect(pieces).toHaveLength(2)
    const outer = pieces.find((p) => p.area > 5000)!
    const inner = pieces.find((p) => p.area < 5000)!
    expect(outer.holes).toHaveLength(1)
    expect(outer.area).toBeCloseTo(10000 - 400, 3)
    expect(inner.area).toBeCloseTo(400, 3)
    // Conservation: outer glass + inner glass = border area.
    expect(outer.area + inner.area).toBeCloseTo(10000, 3)
  })
})

describe('detectPieces — determinism (FR-2)', () => {
  const nodes: Record<string, Vec2> = {
    n0: vec2(0, 0),
    n1: vec2(100, 0),
    n2: vec2(100, 100),
    n3: vec2(0, 100),
    c: vec2(50, 50),
  }
  const edges: Array<[string, string, string?]> = [
    ['n0', 'n1'],
    ['n1', 'n2'],
    ['n2', 'n3'],
    ['n3', 'n0'],
    ['n0', 'c'],
    ['n1', 'c'],
    ['n2', 'c'],
    ['n3', 'c'],
  ]

  it('produces identical output on repeated runs', () => {
    const a = detectPieces(net(nodes, edges))
    const b = detectPieces(net(nodes, edges))
    expect(b).toEqual(a)
  })

  it('is independent of input segment order', () => {
    const base = net(nodes, edges)
    const shuffled = [
      base[3]!,
      base[7]!,
      base[0]!,
      base[5]!,
      base[1]!,
      base[6]!,
      base[2]!,
      base[4]!,
    ]
    const a = detectPieces(base)
    const b = detectPieces(shuffled)
    expect(b.pieces.map((p) => [p.id, Math.round(p.area)])).toEqual(
      a.pieces.map((p) => [p.id, Math.round(p.area)]),
    )
  })
})

/** A square with a vertical divider at `x`, splitting it into two rectangles. */
function splitSquare(x: number): PieceSegment[] {
  return [
    ...net(SQUARE, [
      ['n0', 'n1'],
      ['n1', 'n2'],
      ['n2', 'n3'],
      ['n3', 'n0'],
    ]),
    {
      id: 'divider',
      geometry: line(vec2(x, 0), vec2(x, 100)),
      role: 'lead',
      endpoints: ['d0', 'd1'],
    },
  ]
}

describe('detectPieces — stable identity (FR-3)', () => {
  const square = net(SQUARE, [
    ['n0', 'n1'],
    ['n1', 'n2'],
    ['n2', 'n3'],
    ['n3', 'n0'],
  ])

  it('keeps ids when a node moves slightly', () => {
    const nudged = net({ ...SQUARE, n2: vec2(100.3, 99.7) }, [
      ['n0', 'n1'],
      ['n1', 'n2'],
      ['n2', 'n3'],
      ['n3', 'n0'],
    ])
    const first = detectPieces(square)
    const second = detectPieces(nudged, { previous: first.pieces })
    expect(second.pieces[0]!.id).toBe(first.pieces[0]!.id)
  })

  it('splitting keeps the id on the larger fragment and mints one new id', () => {
    const first = detectPieces(square)
    const original = first.pieces[0]!.id
    const second = detectPieces(splitSquare(30), { previous: first.pieces })
    expect(second.pieces).toHaveLength(2)
    const larger = second.pieces.reduce((a, b) => (a.area >= b.area ? a : b))
    const smaller = second.pieces.reduce((a, b) => (a.area < b.area ? a : b))
    expect(larger.area).toBeCloseTo(7000, 3)
    expect(larger.id).toBe(original)
    expect(smaller.id).not.toBe(original)
  })

  it('merging keeps the larger contributor id', () => {
    const split = detectPieces(splitSquare(30))
    const largerId = split.pieces.reduce((a, b) => (a.area >= b.area ? a : b)).id
    const merged = detectPieces(square, { previous: split.pieces })
    expect(merged.pieces).toHaveLength(1)
    expect(merged.pieces[0]!.id).toBe(largerId)
  })

  it('splitting one piece leaves the other pieces identities untouched', () => {
    const first = detectPieces(splitSquare(50)) // two 5000 halves
    const ids = new Set(first.pieces.map((p) => p.id))
    // Add a horizontal divider only across the right half (splits one piece).
    const withExtra: PieceSegment[] = [
      ...splitSquare(50),
      {
        id: 'h',
        geometry: line(vec2(50, 50), vec2(100, 50)),
        role: 'lead',
        endpoints: ['h0', 'h1'],
      },
    ]
    const second = detectPieces(withExtra, { previous: first.pieces })
    expect(second.pieces).toHaveLength(3)
    // The untouched left half keeps its id; the right half's larger fragment keeps its id.
    const survivors = second.pieces.filter((p) => ids.has(p.id))
    expect(survivors.length).toBe(2)
  })
})

describe('detectPieces — diagnostics (FR-6)', () => {
  it('flags a dangling free end', () => {
    const nodes = { ...SQUARE, free: vec2(150, 150) }
    const segments = net(nodes, [
      ['n0', 'n1'],
      ['n1', 'n2'],
      ['n2', 'n3'],
      ['n3', 'n0'],
      ['n2', 'free', 'spur'],
    ])
    const { pieces, diagnostics } = detectPieces(segments)
    expect(pieces).toHaveLength(1) // the spur is pruned, square still detected
    const dangling = diagnostics.filter((d) => d.kind === 'dangling-end')
    expect(dangling).toHaveLength(1)
    expect(dangling[0]!.segmentIds).toContain('spur')
    expect(dangling[0]!.at).toEqual(vec2(150, 150))
  })

  it('flags a near-miss junction with its measured distance', () => {
    const segments: PieceSegment[] = [
      { id: 'a', geometry: line(vec2(0, 0), vec2(100, 0)), role: 'lead', endpoints: ['a0', 'a1'] },
      {
        id: 'b',
        geometry: line(vec2(100.2, 0), vec2(200, 0)),
        role: 'lead',
        endpoints: ['b0', 'b1'],
      },
    ]
    const near = detectPieces(segments).diagnostics.filter((d) => d.kind === 'near-miss')
    expect(near).toHaveLength(1)
    expect(near[0]!.distance).toBeCloseTo(0.2, 6)
    expect([...near[0]!.segmentIds].sort()).toEqual(['a', 'b'])
  })

  it('flags duplicate / overlapping segments', () => {
    const segments: PieceSegment[] = [
      { id: 'a', geometry: line(vec2(0, 0), vec2(100, 0)), role: 'lead', endpoints: ['a0', 'a1'] },
      { id: 'b', geometry: line(vec2(0, 0), vec2(100, 0)), role: 'lead', endpoints: ['b0', 'b1'] },
    ]
    const dup = detectPieces(segments).diagnostics.filter((d) => d.kind === 'duplicate-segment')
    expect(dup).toHaveLength(1)
    expect([...dup[0]!.segmentIds].sort()).toEqual(['a', 'b'])
  })
})

describe('PieceDetector — incremental', () => {
  it('matches a full recompute and keeps ids across edits', () => {
    const detector = new PieceDetector()
    const first = detector.update(splitSquare(50))
    expect(first.pieces).toHaveLength(2)

    const second = detector.update(splitSquare(30))
    const full = detectPieces(splitSquare(30), { previous: first.pieces })
    expect(second.pieces).toEqual(full.pieces)
  })
})
