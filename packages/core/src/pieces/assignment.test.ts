import { line, vec2, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { pieceKey, resolveGeneration } from './assignment'
import { detectPieces } from './detect'
import { matchIdsWithLineage } from './identity'
import type { Piece, PieceId, PieceSegment, PieceSegmentRole } from './types'

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

const SQUARE = { n0: vec2(0, 0), n1: vec2(100, 0), n2: vec2(100, 100), n3: vec2(0, 100) }
const SQUARE_EDGES: Array<[string, string]> = [
  ['n0', 'n1'],
  ['n1', 'n2'],
  ['n2', 'n3'],
  ['n3', 'n0'],
]

/** A square with a vertical divider at `x`, splitting it into two rectangles. */
function splitSquare(x: number): PieceSegment[] {
  return [
    ...net(SQUARE, SQUARE_EDGES),
    {
      id: 'divider',
      geometry: line(vec2(x, 0), vec2(x, 100)),
      role: 'lead',
      endpoints: ['d0', 'd1'],
    },
  ]
}

/** Run one generation's resolution end-to-end from a detection result. */
function resolve(
  pieces: readonly Piece[],
  lineage: Readonly<Record<PieceId, PieceId>>,
  stored: Record<string, string>,
  prev: Map<PieceId, string> = new Map(),
): Map<PieceId, string> {
  return resolveGeneration(pieces, lineage, stored, prev)
}

describe('lineage (F-023)', () => {
  it('points both split fragments at the parent', () => {
    const first = detectPieces(net(SQUARE, SQUARE_EDGES))
    const parentKey = pieceKey(first.pieces[0]!)
    const split = detectPieces(splitSquare(30), { previous: first.pieces })
    expect(split.pieces).toHaveLength(2)
    for (const p of split.pieces) expect(split.lineage[pieceKey(p)]).toBe(parentKey)
  })

  it('points a merged piece at its larger contributor', () => {
    const split = detectPieces(splitSquare(30))
    const larger = split.pieces.reduce((a, b) => (a.area >= b.area ? a : b))
    const merged = detectPieces(net(SQUARE, SQUARE_EDGES), { previous: split.pieces })
    expect(merged.pieces).toHaveLength(1)
    expect(merged.lineage[pieceKey(merged.pieces[0]!)]).toBe(pieceKey(larger))
  })

  it('is empty on a cold detection', () => {
    expect(detectPieces(net(SQUARE, SQUARE_EDGES)).lineage).toEqual({})
  })

  it('matchIdsWithLineage relabels ids exactly as matchIds does', () => {
    const first = detectPieces(net(SQUARE, SQUARE_EDGES))
    const split = detectPieces(splitSquare(30))
    const { pieces } = matchIdsWithLineage(split.pieces, first.pieces)
    // The larger fragment inherits the parent's id (FR-3).
    const larger = pieces.reduce((a, b) => (a.area >= b.area ? a : b))
    expect(larger.id).toBe(first.pieces[0]!.id)
  })
})

describe('resolveGeneration (F-023)', () => {
  it('resolves a directly painted piece', () => {
    const first = detectPieces(net(SQUARE, SQUARE_EDGES))
    const key = pieceKey(first.pieces[0]!)
    const effective = resolve(first.pieces, first.lineage, { [key]: 'glass-1' })
    expect(effective.get(key)).toBe('glass-1')
  })

  it('leaves an unpainted piece unassigned', () => {
    const first = detectPieces(net(SQUARE, SQUARE_EDGES))
    const effective = resolve(first.pieces, first.lineage, {})
    expect(effective.size).toBe(0)
  })

  it('both fragments inherit the parent glass on split (FR-2)', () => {
    const first = detectPieces(net(SQUARE, SQUARE_EDGES))
    const parentKey = pieceKey(first.pieces[0]!)
    const gen0 = resolve(first.pieces, first.lineage, { [parentKey]: 'glass-1' })

    const split = detectPieces(splitSquare(30), { previous: first.pieces })
    const gen1 = resolve(split.pieces, split.lineage, { [parentKey]: 'glass-1' }, gen0)
    expect(gen1.size).toBe(2)
    for (const p of split.pieces) expect(gen1.get(pieceKey(p))).toBe('glass-1')
  })

  it('a merged piece inherits the larger contributor glass (FR-2)', () => {
    const split = detectPieces(splitSquare(30))
    const larger = split.pieces.reduce((a, b) => (a.area >= b.area ? a : b))
    const smaller = split.pieces.reduce((a, b) => (a.area < b.area ? a : b))
    const stored = { [pieceKey(larger)]: 'glass-big', [pieceKey(smaller)]: 'glass-small' }
    const gen0 = resolve(split.pieces, split.lineage, stored)

    const merged = detectPieces(net(SQUARE, SQUARE_EDGES), { previous: split.pieces })
    const gen1 = resolve(merged.pieces, merged.lineage, stored, gen0)
    expect(gen1.get(pieceKey(merged.pieces[0]!))).toBe('glass-big')
  })

  it('inheritance survives a chain of splits without a stored key (multi-hop)', () => {
    // Paint the whole square, then split it twice; the second-generation fragments have no
    // stored assignment but inherit through the carried-forward effective maps.
    const first = detectPieces(net(SQUARE, SQUARE_EDGES))
    const parentKey = pieceKey(first.pieces[0]!)
    const stored = { [parentKey]: 'glass-1' }
    const gen0 = resolve(first.pieces, first.lineage, stored)

    const split1 = detectPieces(splitSquare(30), { previous: first.pieces })
    const gen1 = resolve(split1.pieces, split1.lineage, stored, gen0)

    // Split again (a different divider position) against the previous generation.
    const split2 = detectPieces(splitSquare(70), { previous: split1.pieces })
    const gen2 = resolve(split2.pieces, split2.lineage, stored, gen1)
    for (const p of split2.pieces) expect(gen2.get(pieceKey(p))).toBe('glass-1')
  })

  it('a piece painted then reshaped keeps its glass in the same session', () => {
    const first = detectPieces(net(SQUARE, SQUARE_EDGES))
    const key0 = pieceKey(first.pieces[0]!)
    const gen0 = resolve(first.pieces, first.lineage, { [key0]: 'glass-1' })

    // Nudge a corner: same piece, new ring → new content key, lineage points back.
    const reshaped = detectPieces(net({ ...SQUARE, n2: vec2(110, 95) }, SQUARE_EDGES), {
      previous: first.pieces,
    })
    const gen1 = resolve(reshaped.pieces, reshaped.lineage, { [key0]: 'glass-1' }, gen0)
    expect(gen1.get(pieceKey(reshaped.pieces[0]!))).toBe('glass-1')
  })

  it('a cold reload resolves colours directly from stored content-keyed assignments (FR-5)', () => {
    // What the save-time normaliser persists: every live piece keyed by its content id. A fresh
    // (cold) detection reproduces those keys, so a reload resolves with no previous/lineage.
    const split = detectPieces(splitSquare(40))
    const stored: Record<string, string> = {}
    split.pieces.forEach((p, i) => (stored[pieceKey(p)] = `glass-${i}`))

    const reloaded = detectPieces(splitSquare(40)) // cold, no previous
    const effective = resolve(reloaded.pieces, reloaded.lineage, stored)
    expect(effective.size).toBe(2)
    reloaded.pieces.forEach((p) => expect(effective.get(pieceKey(p))).toBe(stored[pieceKey(p)]))
  })
})
