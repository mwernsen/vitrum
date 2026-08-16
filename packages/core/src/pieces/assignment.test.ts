import { line, vec2, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { pieceKey, resolveGeneration, type GenerationResolution } from './assignment'
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

/**
 * Run one generation's resolution end-to-end from a detection result. `prev` is the previous
 * generation's **provenance** (`origins`), which is what carries inheritance forward.
 */
function resolve(
  pieces: readonly Piece[],
  lineage: Readonly<Record<PieceId, PieceId>>,
  stored: Record<string, string>,
  prev: ReadonlyMap<PieceId, PieceId> = new Map(),
): GenerationResolution {
  return resolveGeneration(pieces, lineage, stored, prev)
}

/** The lineage a re-detection produces when nothing moved: every piece is its own ancestor. */
function selfLineage(pieces: readonly Piece[]): Record<PieceId, PieceId> {
  return Object.fromEntries(pieces.map((p) => [pieceKey(p), pieceKey(p)]))
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
    const { effective, origins } = resolve(first.pieces, first.lineage, { [key]: 'glass-1' })
    expect(effective.get(key)).toBe('glass-1')
    // Painted here, so the piece is its own provenance.
    expect(origins.get(key)).toBe(key)
  })

  it('leaves an unpainted piece unassigned', () => {
    const first = detectPieces(net(SQUARE, SQUARE_EDGES))
    const { effective } = resolve(first.pieces, first.lineage, {})
    expect(effective.size).toBe(0)
  })

  it('both fragments inherit the parent glass on split (FR-2)', () => {
    const first = detectPieces(net(SQUARE, SQUARE_EDGES))
    const parentKey = pieceKey(first.pieces[0]!)
    const gen0 = resolve(first.pieces, first.lineage, { [parentKey]: 'glass-1' })

    const split = detectPieces(splitSquare(30), { previous: first.pieces })
    const gen1 = resolve(split.pieces, split.lineage, { [parentKey]: 'glass-1' }, gen0.origins)
    expect(gen1.effective.size).toBe(2)
    for (const p of split.pieces) {
      expect(gen1.effective.get(pieceKey(p))).toBe('glass-1')
      expect(gen1.origins.get(pieceKey(p))).toBe(parentKey)
    }
  })

  it('a merged piece inherits the larger contributor glass (FR-2)', () => {
    const split = detectPieces(splitSquare(30))
    const larger = split.pieces.reduce((a, b) => (a.area >= b.area ? a : b))
    const smaller = split.pieces.reduce((a, b) => (a.area < b.area ? a : b))
    const stored = { [pieceKey(larger)]: 'glass-big', [pieceKey(smaller)]: 'glass-small' }
    const gen0 = resolve(split.pieces, split.lineage, stored)

    const merged = detectPieces(net(SQUARE, SQUARE_EDGES), { previous: split.pieces })
    const gen1 = resolve(merged.pieces, merged.lineage, stored, gen0.origins)
    expect(gen1.effective.get(pieceKey(merged.pieces[0]!))).toBe('glass-big')
  })

  it('inheritance survives a chain of splits without a stored key (multi-hop)', () => {
    // Paint the whole square, then split it twice; the second-generation fragments have no
    // stored assignment but inherit through the carried-forward effective maps.
    const first = detectPieces(net(SQUARE, SQUARE_EDGES))
    const parentKey = pieceKey(first.pieces[0]!)
    const stored = { [parentKey]: 'glass-1' }
    const gen0 = resolve(first.pieces, first.lineage, stored)

    const split1 = detectPieces(splitSquare(30), { previous: first.pieces })
    const gen1 = resolve(split1.pieces, split1.lineage, stored, gen0.origins)

    // Split again (a different divider position) against the previous generation.
    const split2 = detectPieces(splitSquare(70), { previous: split1.pieces })
    const gen2 = resolve(split2.pieces, split2.lineage, stored, gen1.origins)
    for (const p of split2.pieces) expect(gen2.effective.get(pieceKey(p))).toBe('glass-1')
  })

  it('a piece painted then reshaped keeps its glass in the same session', () => {
    const first = detectPieces(net(SQUARE, SQUARE_EDGES))
    const key0 = pieceKey(first.pieces[0]!)
    const gen0 = resolve(first.pieces, first.lineage, { [key0]: 'glass-1' })

    // Nudge a corner: same piece, new ring → new content key, lineage points back.
    const reshaped = detectPieces(net({ ...SQUARE, n2: vec2(110, 95) }, SQUARE_EDGES), {
      previous: first.pieces,
    })
    const gen1 = resolve(reshaped.pieces, reshaped.lineage, { [key0]: 'glass-1' }, gen0.origins)
    expect(gen1.effective.get(pieceKey(reshaped.pieces[0]!))).toBe('glass-1')
  })

  it('a cold reload resolves colours directly from stored content-keyed assignments (FR-5)', () => {
    // What the save-time normaliser persists: every live piece keyed by its content id. A fresh
    // (cold) detection reproduces those keys, so a reload resolves with no previous/lineage.
    const split = detectPieces(splitSquare(40))
    const stored: Record<string, string> = {}
    split.pieces.forEach((p, i) => (stored[pieceKey(p)] = `glass-${i}`))

    const reloaded = detectPieces(splitSquare(40)) // cold, no previous
    const { effective } = resolve(reloaded.pieces, reloaded.lineage, stored)
    expect(effective.size).toBe(2)
    reloaded.pieces.forEach((p) => expect(effective.get(pieceKey(p))).toBe(stored[pieceKey(p)]))
  })
})

describe('resolveGeneration — removal takes effect at once (fix 2026-08-16)', () => {
  // Regression for the F-023 follow-up "removing a glass does not take effect until the geometry
  // changes or the file reloads": with unchanged geometry a re-detection's lineage maps every piece
  // to *itself*, so carrying resolved **values** forward let a piece inherit back the colour the user
  // had just cleared. Provenance is carried instead, and the value re-read from the document.
  it('does not resurrect a cleared assignment through self-lineage', () => {
    const gen = detectPieces(net(SQUARE, SQUARE_EDGES))
    const key = pieceKey(gen.pieces[0]!)
    const painted = resolve(gen.pieces, gen.lineage, { [key]: 'glass-1' })
    expect(painted.effective.get(key)).toBe('glass-1')

    // What a re-detection after the unassign (or an undo of the paint) looks like: same geometry.
    const cleared = resolve(gen.pieces, selfLineage(gen.pieces), {}, painted.origins)
    expect(cleared.effective.get(key)).toBeUndefined()
    expect(cleared.origins.size).toBe(0)
  })

  it('shows the document value, so repainting is never masked by the previous generation', () => {
    const gen = detectPieces(net(SQUARE, SQUARE_EDGES))
    const key = pieceKey(gen.pieces[0]!)
    const first = resolve(gen.pieces, gen.lineage, { [key]: 'glass-1' })
    const second = resolve(gen.pieces, selfLineage(gen.pieces), { [key]: 'glass-2' }, first.origins)
    expect(second.effective.get(key)).toBe('glass-2')
  })

  it('drops the colour of both split fragments when the parent entry is cleared', () => {
    // Inheritance (FR-2) must stay live rather than latch: the fragments read the parent's entry, so
    // clearing it clears them, and changing it changes them.
    const first = detectPieces(net(SQUARE, SQUARE_EDGES))
    const parentKey = pieceKey(first.pieces[0]!)
    const gen0 = resolve(first.pieces, first.lineage, { [parentKey]: 'glass-1' })
    const split = detectPieces(splitSquare(30), { previous: first.pieces })
    const gen1 = resolve(split.pieces, split.lineage, { [parentKey]: 'glass-1' }, gen0.origins)
    expect(gen1.effective.size).toBe(2)

    const gen2 = resolve(split.pieces, selfLineage(split.pieces), {}, gen1.origins)
    expect(gen2.effective.size).toBe(0)
  })

  it('clears the whole symmetry orbit when the source entry is cleared', () => {
    const first = detectPieces(splitSquare(50))
    const [source, replica] = first.pieces
    const sourceKey = pieceKey(source!)
    const replicaKey = pieceKey(replica!)
    const sym = { [replicaKey]: sourceKey }

    const painted = resolveGeneration(first.pieces, {}, { [sourceKey]: 'glass-1' }, new Map(), sym)
    expect(painted.effective.size).toBe(2)

    const cleared = resolveGeneration(
      first.pieces,
      selfLineage(first.pieces),
      {},
      painted.origins,
      sym,
    )
    expect(cleared.effective.size).toBe(0)
  })
})

describe('resolveGeneration — symmetry inheritance (F-052 [S2])', () => {
  // A four-fold rosette: `src` is the source-sector piece, `a`/`b`/`c` its live replicas. The orbit
  // map is what `pieceOrbits` returns; here it is written out so the precedence rules are legible.
  const rosette = (): {
    pieces: Piece[]
    keys: { src: PieceId; a: PieceId; b: PieceId; c: PieceId }
    sym: Record<PieceId, PieceId>
  } => {
    const pieces: Piece[] = []
    for (const dx of [0, 200, 400, 600]) {
      pieces.push(
        ...detectPieces(
          net(
            {
              n0: vec2(dx, 0),
              n1: vec2(dx + 100, 0),
              n2: vec2(dx + 100, 100),
              n3: vec2(dx, 100),
            },
            SQUARE_EDGES,
          ),
        ).pieces,
      )
    }
    const [src, a, b, c] = pieces.map(pieceKey) as [PieceId, PieceId, PieceId, PieceId]
    return { pieces, keys: { src, a, b, c }, sym: { [a]: src, [b]: src, [c]: src } }
  }

  it('gives every replica the source piece glass — painted once, shown four times', () => {
    const { pieces, keys, sym } = rosette()
    const { effective, origins } = resolveGeneration(
      pieces,
      {},
      { [keys.src]: 'amber' },
      new Map(),
      sym,
    )
    expect(effective.size).toBe(4)
    for (const key of Object.values(keys)) {
      expect(effective.get(key)).toBe('amber')
      // Every sector reads the one stored entry, which is why repainting the source follows.
      expect(origins.get(key)).toBe(keys.src)
    }
  })

  it('resolves on a cold detection, so a reopened symmetric file is coloured (FR-5)', () => {
    // No previous generation and no lineage — exactly the reload path. Only the source piece needs a
    // stored entry, which is why no schema change or per-replica materialisation is required.
    const { pieces, keys, sym } = rosette()
    const { effective } = resolveGeneration(pieces, {}, { [keys.src]: 'amber' }, new Map(), sym)
    expect(effective.get(keys.c)).toBe('amber')
  })

  it('leaves the whole orbit unassigned when the source piece has no glass', () => {
    const { pieces, sym } = rosette()
    expect(resolveGeneration(pieces, {}, {}, new Map(), sym).effective.size).toBe(0)
  })

  it('a direct assignment on a replica still wins — saved files resolve as they always did', () => {
    // A document painted sector-by-sector before symmetry inheritance existed stores one entry per
    // replica. Those entries outrank the source, so its colours are unchanged by this feature.
    const { pieces, keys, sym } = rosette()
    const stored = { [keys.src]: 'amber', [keys.a]: 'ruby', [keys.b]: 'ruby' }
    const { effective } = resolveGeneration(pieces, {}, stored, new Map(), sym)
    expect(effective.get(keys.src)).toBe('amber')
    expect(effective.get(keys.a)).toBe('ruby')
    expect(effective.get(keys.b)).toBe('ruby')
    expect(effective.get(keys.c)).toBe('amber')
  })

  it('a replica tracks the source colour even across an intervening geometry edit', () => {
    // Symmetry must outrank edit inheritance: a replica must show the source's *current* colour, not
    // the one the previous generation resolved for it.
    const { pieces, keys, sym } = rosette()
    const gen0 = resolveGeneration(pieces, {}, { [keys.src]: 'amber' }, new Map(), sym)
    expect(gen0.effective.get(keys.a)).toBe('amber')

    // New generation, same geometry (lineage maps each piece to itself), source repainted.
    const gen1 = resolveGeneration(
      pieces,
      selfLineage(pieces),
      { [keys.src]: 'ruby' },
      gen0.origins,
      sym,
    )
    for (const key of Object.values(keys)) expect(gen1.effective.get(key)).toBe('ruby')
  })

  it('falls back to edit inheritance for a replica whose source has no glass', () => {
    // A replica painted under an earlier setup keeps its colour rather than being blanked when the
    // orbit it now belongs to has an unpainted source. Exercised the way it actually happens: the
    // replica is *reshaped* (new content id, so no direct entry of its own) while its stored entry
    // stays on the old key. Emptying `stored` instead would say something quite different — that a
    // removed assignment lives on, which is the bug fixed on 2026-08-16.
    const { pieces, keys, sym } = rosette()
    const gen0 = resolveGeneration(pieces, {}, { [keys.a]: 'ruby' }, new Map(), sym)

    const moved = detectPieces(
      net(
        { n0: vec2(200, 0), n1: vec2(300, 0), n2: vec2(300, 110), n3: vec2(200, 110) },
        SQUARE_EDGES,
      ),
    ).pieces
    const movedKey = pieceKey(moved[0]!)
    const next = [pieces[0]!, ...moved, pieces[2]!, pieces[3]!]
    const lineage = { ...selfLineage(next), [movedKey]: keys.a }
    const symNext = { ...sym, [movedKey]: keys.src }
    delete symNext[keys.a]

    const gen1 = resolveGeneration(next, lineage, { [keys.a]: 'ruby' }, gen0.origins, symNext)
    expect(gen1.effective.get(movedKey)).toBe('ruby')
    expect(gen1.effective.get(keys.src)).toBeUndefined()
  })

  it('is unchanged when no orbit map is supplied (F-023 behaviour by default)', () => {
    const { pieces, keys } = rosette()
    const { effective } = resolveGeneration(pieces, {}, { [keys.src]: 'amber' }, new Map())
    expect(effective.size).toBe(1)
    expect(effective.get(keys.a)).toBeUndefined()
  })
})
