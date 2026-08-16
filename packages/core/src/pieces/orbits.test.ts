import { line, vec2, type Vec2 } from '@vitrum/geometry'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { expandNetwork } from '../symmetry/expand'
import { symmetryTransforms } from '../symmetry/transform'
import type { NetworkSegment, SymmetrySetup } from '../symmetry/types'

import { pieceKey } from './assignment'
import { detectPieces } from './detect'
import { pieceOrbits } from './orbits'
import type { Piece, PieceSegment } from './types'

const CENTER = vec2(0, 0)

function setup(over: Partial<SymmetrySetup>): SymmetrySetup {
  return { mode: 'none', center: CENTER, angle: Math.PI / 2, count: 4, mirror: false, ...over }
}

/** A polyline through `points`, one lead segment per span, welded at shared node ids. */
function chain(prefix: string, points: readonly Vec2[]): NetworkSegment[] {
  const out: NetworkSegment[] = []
  for (let i = 0; i + 1 < points.length; i++) {
    out.push({
      id: `${prefix}${i}`,
      geometry: line(points[i]!, points[i + 1]!),
      role: 'lead',
      endpoints: [`${prefix}n${i}`, `${prefix}n${i + 1}`],
    })
  }
  return out
}

/** A closed square centred on `at`, which traces to exactly one piece. */
function square(prefix: string, at: Vec2, size: number): NetworkSegment[] {
  const h = size / 2
  return chain(prefix, [
    vec2(at.x - h, at.y - h),
    vec2(at.x + h, at.y - h),
    vec2(at.x + h, at.y + h),
    vec2(at.x - h, at.y + h),
    vec2(at.x - h, at.y - h),
  ])
}

/** The angular span of a setup's source fundamental domain, from `setup.angle`. */
function domain(s: SymmetrySetup): { start: number; span: number } {
  switch (s.mode) {
    case 'none':
      return { start: s.angle, span: 2 * Math.PI }
    case 'mirror':
      return { start: s.angle, span: Math.PI }
    case 'double-mirror':
      return { start: s.angle + Math.PI / 2, span: Math.PI / 2 }
    case 'radial': {
      const wedge = (2 * Math.PI) / Math.max(2, Math.floor(s.count))
      return { start: s.angle, span: s.mirror ? wedge / 2 : wedge }
    }
  }
}

/**
 * A small square on the bisector of the source domain, far enough out that no sector image can
 * overlap another — so each sector traces to exactly one piece and the multiplicity is readable.
 */
function sourceSquare(s: SymmetrySetup): NetworkSegment[] {
  const { start, span } = domain(s)
  const theta = start + span / 2
  return square('sq', vec2(100 * Math.cos(theta), 100 * Math.sin(theta)), 12)
}

/** Detect over the expanded network the way the shell does, and return pieces keyed by content id. */
function detectExpanded(source: readonly NetworkSegment[], s: SymmetrySetup): readonly Piece[] {
  return detectPieces(expandNetwork(source, s) as PieceSegment[]).pieces
}

describe('pieceOrbits — replica → source (F-052 [S2])', () => {
  it('is empty when symmetry is off', () => {
    const off = setup({ mode: 'none' })
    const source = sourceSquare(off)
    expect(pieceOrbits(detectExpanded(source, off), off)).toEqual({})
    expect(pieceOrbits(detectExpanded(source, off), undefined)).toEqual({})
  })

  it('maps the mirrored piece to the source piece, and never the other way round', () => {
    const mirror = setup({ mode: 'mirror' })
    const source = sourceSquare(mirror)
    const pieces = detectExpanded(source, mirror)
    expect(pieces).toHaveLength(2)

    const orbits = pieceOrbits(pieces, mirror)
    // Exactly one piece is a replica; the piece it names is the other one, and it is a source.
    const replicas = Object.keys(orbits)
    expect(replicas).toHaveLength(1)
    const sourceKey = orbits[replicas[0]!]!
    expect(orbits[sourceKey]).toBeUndefined()
    expect(new Set(pieces.map(pieceKey))).toEqual(new Set([replicas[0]!, sourceKey]))
  })

  it('points every sector at one source under radial N (the whole rosette follows it)', () => {
    for (const count of [2, 3, 4, 6]) {
      const radial = setup({ mode: 'radial', count })
      const pieces = detectExpanded(sourceSquare(radial), radial)
      expect(pieces).toHaveLength(count)
      const orbits = pieceOrbits(pieces, radial)
      // N − 1 replicas, all naming the same single source.
      expect(Object.keys(orbits)).toHaveLength(count - 1)
      expect(new Set(Object.values(orbits)).size).toBe(1)
    }
  })

  it('covers 2N pieces with radial + mirror', () => {
    const dihedral = setup({ mode: 'radial', count: 3, mirror: true })
    const pieces = detectExpanded(sourceSquare(dihedral), dihedral)
    expect(pieces).toHaveLength(6)
    const orbits = pieceOrbits(pieces, dihedral)
    expect(Object.keys(orbits)).toHaveLength(5)
    expect(new Set(Object.values(orbits)).size).toBe(1)
  })

  it('groups pieces that straddle a sector seam (the Art Deco border case)', () => {
    // An open "U" in the source quadrant whose ends sit on the mirror axis (x = 0). Under a double
    // mirror the U plus its own reflection close into one box straddling the vertical axis, and the
    // x-axis reflection maps that box to a second box below — an orbit of two straddling pieces,
    // which a "strip the ~symN suffix" shortcut would never find.
    const u = chain('u', [vec2(0, 10), vec2(40, 10), vec2(40, 50), vec2(0, 50)])
    const dbl = setup({ mode: 'double-mirror' })
    const pieces = detectExpanded(u, dbl)
    expect(pieces).toHaveLength(2)

    const orbits = pieceOrbits(pieces, dbl)
    expect(Object.keys(orbits)).toHaveLength(1)
    const replicaKey = Object.keys(orbits)[0]!
    const replica = pieces.find((p) => pieceKey(p) === replicaKey)!
    const src = pieces.find((p) => pieceKey(p) === orbits[replicaKey])!
    // The source is the box in the source half (positive y); the replica is its image below.
    expect(src.centroid.y).toBeGreaterThan(0)
    expect(replica.centroid.y).toBeLessThan(0)
  })

  it('leaves a piece that is its own image ungrouped', () => {
    // The same U, but under a single mirror: the U and its reflection close into one box astride the
    // axis. It is its own image, so there is nothing to inherit from.
    const u = chain('u', [vec2(0, 10), vec2(40, 10), vec2(40, 50), vec2(0, 50)])
    const mirror = setup({ mode: 'mirror' })
    const pieces = detectExpanded(u, mirror)
    expect(pieces).toHaveLength(1)
    expect(pieceOrbits(pieces, mirror)).toEqual({})
  })

  it('ignores pieces whose sector index is outside the current group', () => {
    // Pieces detected under a 6-fold setup, read against a 3-fold one (a stale generation): the
    // out-of-range sectors must simply not group rather than mis-map.
    const six = setup({ mode: 'radial', count: 6 })
    const pieces = detectExpanded(sourceSquare(six), six)
    const orbits = pieceOrbits(pieces, setup({ mode: 'radial', count: 3 }))
    // Only the three in-range sectors can be grouped; nothing points at an out-of-range piece.
    for (const [replica, src] of Object.entries(orbits)) {
      expect(replica).not.toBe(src)
      expect(orbits[src]).toBeUndefined()
    }
  })
})

describe('pieceOrbits — determinism and geometric soundness (property)', () => {
  const mode = fc.constantFrom<SymmetrySetup['mode']>('mirror', 'double-mirror', 'radial')

  const scenario = fc
    .record({
      mode,
      count: fc.integer({ min: 2, max: 6 }),
      mirror: fc.boolean(),
      angle: fc.integer({ min: 0, max: 179 }).map((deg) => (deg * Math.PI) / 180),
    })
    .map((r) => {
      const s = setup(r)
      return { s, source: sourceSquare(s) }
    })

  it('is independent of piece order and reproduces itself exactly', () => {
    fc.assert(
      fc.property(scenario, fc.integer({ min: 0, max: 11 }), ({ s, source }, rotate) => {
        const pieces = detectExpanded(source, s)
        const shift = rotate % Math.max(1, pieces.length)
        const shuffled = [...pieces.slice(shift), ...pieces.slice(0, shift)]
        expect(pieceOrbits(shuffled, s)).toEqual(pieceOrbits(pieces, s))
      }),
      { numRuns: 60 },
    )
  })

  it('only ever pairs pieces that are genuine rigid images of one another', () => {
    fc.assert(
      fc.property(scenario, ({ s, source }) => {
        const pieces = detectExpanded(source, s)
        const byKey = new Map(pieces.map((p) => [pieceKey(p), p]))
        const orbits = pieceOrbits(pieces, s)
        for (const [replicaKey, sourceKey] of Object.entries(orbits)) {
          const replica = byKey.get(replicaKey)
          const src = byKey.get(sourceKey)
          expect(replica).toBeDefined()
          expect(src).toBeDefined()
          // A rigid image preserves area and perimeter, and a source is never itself a replica.
          expect(replica!.area).toBeCloseTo(src!.area, 6)
          expect(replica!.perimeter).toBeCloseTo(src!.perimeter, 6)
          expect(orbits[sourceKey]).toBeUndefined()
        }
      }),
      { numRuns: 60 },
    )
  })

  it('never groups more pieces than the symmetry group has elements', () => {
    fc.assert(
      fc.property(scenario, ({ s, source }) => {
        const pieces = detectExpanded(source, s)
        const orbits = pieceOrbits(pieces, s)
        const sizes = new Map<string, number>()
        for (const sourceKey of Object.values(orbits)) {
          sizes.set(sourceKey, (sizes.get(sourceKey) ?? 0) + 1)
        }
        const order = symmetryTransforms(s).length
        for (const size of sizes.values()) expect(size + 1).toBeLessThanOrEqual(order)
      }),
      { numRuns: 60 },
    )
  })
})
