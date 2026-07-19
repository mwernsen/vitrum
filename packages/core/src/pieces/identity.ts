import { overlapArea, type Vec2 } from '@vitrum/geometry'

import type { Piece, PieceId } from './types'

/**
 * Stable piece identity (FR-3), kept as a separate pass from face tracing (technical
 * guidance). Ids must be deterministic (FR-2) *and* survive edits that don't meaningfully
 * change a region, so downstream glass (F-023) and numbering (F-040) don't shuffle when one
 * line is redrawn.
 *
 * Two mechanisms:
 * - **Cold id** ({@link contentId}): a deterministic hash of the flattened ring, so a
 *   detection with no previous generation still gives the same document the same ids.
 * - **Generational matching** ({@link matchIds}): each new face claims the previous piece it
 *   overlaps most (greedy over descending overlap area, each side used once). A split leaves
 *   the larger fragment matched to the original (it overlaps most) and the smaller fragment
 *   unmatched (new id); a merge is claimed by the larger contributor.
 */

const OVERLAP_EPS = 1e-6

/** Round a coordinate to 1e-4 mm so floating-point noise can't perturb the cold id. */
function quantize(v: number): number {
  return Math.round(v * 1e4)
}

/** A deterministic id derived from a ring's rounded vertices (FNV-1a → base36). */
export function contentId(ring: readonly Vec2[]): PieceId {
  let h = 0x811c9dc5
  const mix = (n: number): void => {
    h ^= n & 0xffffffff
    h = Math.imul(h, 0x01000193)
  }
  for (const p of ring) {
    mix(quantize(p.x))
    mix(quantize(p.y))
  }
  return `p-${(h >>> 0).toString(36)}`
}

/**
 * Replace each piece's id with the id of the previous-generation piece it overlaps most.
 * Unmatched pieces keep their (deterministic) cold id. Pure and order-stable: ties break on
 * `(previous index, piece index)` so the result is a deterministic function of its inputs
 * (FR-2), which also makes incremental detection reproduce a full recompute exactly (FR-4).
 */
export function matchIds(pieces: readonly Piece[], previous: readonly Piece[]): Piece[] {
  if (previous.length === 0) return [...pieces]

  const candidates: Array<{ prev: number; cur: number; overlap: number }> = []
  for (let p = 0; p < previous.length; p++) {
    for (let c = 0; c < pieces.length; c++) {
      const overlap = overlapArea(previous[p]!.ring, pieces[c]!.ring)
      if (overlap > OVERLAP_EPS) candidates.push({ prev: p, cur: c, overlap })
    }
  }
  candidates.sort((a, b) => b.overlap - a.overlap || a.prev - b.prev || a.cur - b.cur)

  const idForPiece = new Map<number, PieceId>()
  const usedPrev = new Set<number>()
  for (const { prev, cur, overlap } of candidates) {
    void overlap
    if (usedPrev.has(prev) || idForPiece.has(cur)) continue
    usedPrev.add(prev)
    idForPiece.set(cur, previous[prev]!.id)
  }

  return pieces.map((piece, c) => {
    const matched = idForPiece.get(c)
    return matched && matched !== piece.id ? { ...piece, id: matched } : piece
  })
}

/**
 * Piece ancestry across a generation, for glass-assignment inheritance (F-023). Unlike
 * {@link matchIds} — which is a one-to-one id claim used to keep display ids stable — lineage is
 * a **many-to-one** map from each current piece to the previous piece it overlaps most (its
 * ancestor). A split therefore points *both* fragments at the parent (so both inherit its glass),
 * and a merge points the merged piece at its largest contributor (so it inherits that glass,
 * matching FR-3's "larger contributor keeps the id").
 *
 * Both sides are keyed by {@link contentId} of the ring (not the possibly-inherited display id),
 * so the lineage — and the assignments that key off it — are reproducible from geometry alone and
 * survive a save/reload (F-023 FR-5).
 */
export interface LineageResult {
  /** The current pieces with stable display ids (identical to {@link matchIds}). */
  readonly pieces: Piece[]
  /** `contentId(current.ring)` → `contentId(ancestor.ring)` for each piece with an ancestor. */
  readonly lineage: Record<PieceId, PieceId>
}

/** Relabel current pieces (as {@link matchIds}) *and* return their ancestry (F-023). */
export function matchIdsWithLineage(
  pieces: readonly Piece[],
  previous: readonly Piece[],
): LineageResult {
  const relabeled = matchIds(pieces, previous)
  const lineage: Record<PieceId, PieceId> = {}
  if (previous.length === 0) return { pieces: relabeled, lineage }

  for (const cur of pieces) {
    let bestPrev = -1
    let bestOverlap = OVERLAP_EPS
    for (let p = 0; p < previous.length; p++) {
      const overlap = overlapArea(previous[p]!.ring, cur.ring)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        bestPrev = p
      }
    }
    if (bestPrev >= 0) lineage[contentId(cur.ring)] = contentId(previous[bestPrev]!.ring)
  }
  return { pieces: relabeled, lineage }
}
