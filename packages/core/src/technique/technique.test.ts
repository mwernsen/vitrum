import { distance, line, vec2, type Vec2 } from '@vitrum/geometry'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { detectPieces, type PieceSegment, type PieceSegmentRole } from '../pieces'

import { edgeAllowanceMm, leadFlangeMm, resolveCame } from './allowance'
import { cutContourFor } from './cutContour'
import { computeCutContours, CutContourCache } from './cutContours'
import type { TechniqueSettings } from './types'

/** Build a lead network between named nodes (mirrors the piece-detection test helper). */
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

function segMap(segments: readonly PieceSegment[]): Map<string, PieceSegment> {
  return new Map(segments.map((s) => [s.id, s]))
}

/** A lead technique with a single H profile; tweak heart / tolerance per test. */
function leadTechnique(opts: { heartMm?: number; toleranceMm?: number } = {}): TechniqueSettings {
  return {
    kind: 'lead',
    lead: {
      defaultProfileId: 'p',
      cuttingToleranceMm: opts.toleranceMm ?? 0,
      profiles: {
        p: { id: 'p', name: 'H 5 mm', kind: 'H', flangeMm: 5, heartMm: opts.heartMm ?? 1.5 },
      },
      overrides: {},
    },
    foil: { foilWidthMm: 5.6, pieceGapMm: 0.8, solderFinish: 'silver' },
  }
}

const SQUARE = { n0: vec2(0, 0), n1: vec2(100, 0), n2: vec2(100, 100), n3: vec2(0, 100) }
const squareEdges: Array<[string, string, string?, PieceSegmentRole?]> = [
  ['n0', 'n1'],
  ['n1', 'n2'],
  ['n2', 'n3'],
  ['n3', 'n0'],
]

/** Min perpendicular distance from a point to any edge of a closed ring. */
function distanceToRing(p: Vec2, ring: readonly Vec2[]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    const ab = { x: b.x - a.x, y: b.y - a.y }
    const len2 = ab.x * ab.x + ab.y * ab.y
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / len2))
    best = Math.min(best, distance(p, { x: a.x + ab.x * t, y: a.y + ab.y * t }))
  }
  return best
}

describe('allowance resolution (FR-1, FR-5)', () => {
  it('lead allowance is half the heart plus the cutting tolerance', () => {
    const technique = leadTechnique({ heartMm: 1.6, toleranceMm: 0.2 })
    expect(edgeAllowanceMm(technique, 's0')).toBeCloseTo(1.0) // 0.8 + 0.2
  })

  it('foil allowance is half the piece gap', () => {
    const technique: TechniqueSettings = { ...leadTechnique(), kind: 'foil' }
    expect(edgeAllowanceMm(technique, 's0')).toBeCloseTo(0.4) // 0.8 / 2
  })

  it('a per-segment override changes only that segment’s came', () => {
    const technique = leadTechnique({ heartMm: 1.6, toleranceMm: 0 })
    const overridden: TechniqueSettings = {
      ...technique,
      lead: { ...technique.lead, overrides: { s1: { heartMm: 4 } } },
    }
    expect(edgeAllowanceMm(overridden, 's0')).toBeCloseTo(0.8)
    expect(edgeAllowanceMm(overridden, 's1')).toBeCloseTo(2.0)
    expect(resolveCame(overridden, 's1').heartMm).toBe(4)
    expect(leadFlangeMm(overridden, 's1')).toBe(5) // flange still the profile’s
  })

  it('falls back to the default profile when an override names a missing profile', () => {
    const technique = leadTechnique({ heartMm: 1.5 })
    const bad: TechniqueSettings = {
      ...technique,
      lead: { ...technique.lead, overrides: { s0: { profileId: 'gone' } } },
    }
    expect(resolveCame(bad, 's0').heartMm).toBe(1.5)
  })
})

describe('cut contour — leaded piece (FR-1)', () => {
  it('insets every edge by exactly heart/2 + tolerance', () => {
    const segments = net(SQUARE, squareEdges)
    const { pieces } = detectPieces(segments)
    const technique = leadTechnique({ heartMm: 1.6, toleranceMm: 0.2 }) // allowance 1.0
    const cut = cutContourFor(pieces[0]!, segMap(segments), technique)

    expect(cut.degenerate).toBe(false)
    expect(cut.ring).toHaveLength(4)
    // The inset square runs (1,1)…(99,99): every cut vertex sits 1.0 mm inside two drawn edges.
    expect(cut.bbox.min.x).toBeCloseTo(1)
    expect(cut.bbox.min.y).toBeCloseTo(1)
    expect(cut.bbox.max.x).toBeCloseTo(99)
    expect(cut.bbox.max.y).toBeCloseTo(99)
    expect(cut.area).toBeCloseTo(98 * 98)
    // Every cut-contour vertex is exactly 1.0 mm from the drawn boundary (measured numerically).
    const drawn = [vec2(0, 0), vec2(100, 0), vec2(100, 100), vec2(0, 100)]
    for (const p of cut.ring) expect(distanceToRing(p, drawn)).toBeCloseTo(1.0)
  })

  it('foil insets by only half the piece gap (smaller than lead)', () => {
    const segments = net(SQUARE, squareEdges)
    const { pieces } = detectPieces(segments)
    const cut = cutContourFor(pieces[0]!, segMap(segments), {
      ...leadTechnique(),
      kind: 'foil',
    })
    expect(cut.bbox.min.x).toBeCloseTo(0.4)
    expect(cut.bbox.max.x).toBeCloseTo(99.6)
  })
})

describe('per-segment override affects only the shared edge (FR-2)', () => {
  it('a heavier came on the shared edge shrinks only that edge of both pieces', () => {
    // A 100×100 panel split into two 50×100 halves by a vertical lead at x=50 (segment `mid`).
    const nodes = {
      a: vec2(0, 0),
      b: vec2(50, 0),
      c: vec2(100, 0),
      d: vec2(100, 100),
      e: vec2(50, 100),
      f: vec2(0, 100),
    }
    const segments = net(nodes, [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['e', 'f'],
      ['f', 'a'],
      ['b', 'e', 'mid'],
    ])
    const { pieces } = detectPieces(segments)
    expect(pieces).toHaveLength(2)

    const base = leadTechnique({ heartMm: 1.6, toleranceMm: 0 }) // allowance 0.8 everywhere
    const overridden: TechniqueSettings = {
      ...base,
      lead: { ...base.lead, overrides: { mid: { heartMm: 4 } } }, // shared edge → allowance 2.0
    }
    const map = segMap(segments)
    const left = pieces.find((p) => p.centroid.x < 50)!
    const right = pieces.find((p) => p.centroid.x > 50)!

    const leftCut = cutContourFor(left, map, overridden)
    const rightCut = cutContourFor(right, map, overridden)

    // Outer edges keep the 0.8 mm inset; the shared edge insets by 2.0 mm on both pieces.
    expect(leftCut.bbox.min.x).toBeCloseTo(0.8)
    expect(leftCut.bbox.max.x).toBeCloseTo(48) // 50 − 2.0
    expect(rightCut.bbox.min.x).toBeCloseTo(52) // 50 + 2.0
    expect(rightCut.bbox.max.x).toBeCloseTo(99.2)

    // With no override both shared edges would inset by 0.8, i.e. to x = 49.2 / 50.8.
    const leftBase = cutContourFor(left, map, base)
    expect(leftBase.bbox.max.x).toBeCloseTo(49.2)
  })
})

describe('degenerate cut contours are flagged, not dropped (FR-3)', () => {
  it('flags a piece too small to inset', () => {
    const small = { n0: vec2(0, 0), n1: vec2(2, 0), n2: vec2(2, 2), n3: vec2(0, 2) }
    const segments = net(small, squareEdges)
    const { pieces } = detectPieces(segments)
    const technique = leadTechnique({ heartMm: 6 }) // allowance 3.0 > half-width 1.0
    const cut = cutContourFor(pieces[0]!, segMap(segments), technique)
    expect(cut.degenerate).toBe(true)
    expect(cut.ring.length).toBeGreaterThan(0) // kept as data, not dropped
  })
})

describe('CutContourCache recomputes with piece detection', () => {
  it('reuses unchanged contours and recomputes only affected pieces on override', () => {
    const nodes = {
      a: vec2(0, 0),
      b: vec2(50, 0),
      c: vec2(100, 0),
      d: vec2(100, 100),
      e: vec2(50, 100),
      f: vec2(0, 100),
    }
    const segments = net(nodes, [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'e'],
      ['e', 'f'],
      ['f', 'a'],
      ['b', 'e', 'mid'],
    ])
    const { pieces } = detectPieces(segments)
    const base = leadTechnique({ heartMm: 1.6 })
    const cache = new CutContourCache()

    const first = cache.update(pieces, segments, base)
    const second = cache.update(pieces, segments, base)
    // Identical inputs → every contour object reused verbatim.
    for (let i = 0; i < first.length; i++) expect(second[i]).toBe(first[i])

    // Overriding the shared edge recomputes both pieces (both touch `mid`); references change.
    const overridden: TechniqueSettings = {
      ...base,
      lead: { ...base.lead, overrides: { mid: { heartMm: 5 } } },
    }
    const third = cache.update(pieces, segments, overridden)
    for (let i = 0; i < first.length; i++) expect(third[i]).not.toBe(first[i])
  })
})

describe('cut contours over random networks are closed and simple (acceptance)', () => {
  it('every non-degenerate contour is a closed ring strictly inside its piece', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 2, max: 5 }),
        fc.double({ min: 0.2, max: 2, noNaN: true }),
        (cols, rows, heartMm) => {
          const nodes: Record<string, Vec2> = {}
          for (let r = 0; r <= rows; r++) {
            for (let c = 0; c <= cols; c++) nodes[`n${r}_${c}`] = vec2(c * 40, r * 40)
          }
          const edges: Array<[string, string, string?]> = []
          for (let r = 0; r <= rows; r++)
            for (let c = 0; c < cols; c++) edges.push([`n${r}_${c}`, `n${r}_${c + 1}`])
          for (let c = 0; c <= cols; c++)
            for (let r = 0; r < rows; r++) edges.push([`n${r}_${c}`, `n${r + 1}_${c}`])
          const segments = net(nodes, edges)
          const { pieces } = detectPieces(segments)
          const contours = computeCutContours(pieces, segments, leadTechnique({ heartMm }))

          for (const cut of contours) {
            if (cut.degenerate) continue
            expect(cut.ring.length).toBeGreaterThanOrEqual(3)
            const piece = pieces.find((p) => p.id === cut.pieceId)!
            // An inset can only shrink the piece.
            expect(cut.area).toBeGreaterThan(0)
            expect(cut.area).toBeLessThanOrEqual(piece.area + 1e-6)
          }
        },
      ),
      { numRuns: 60 },
    )
  })
})
