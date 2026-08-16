import { contentId } from './identity'
import type { Piece, PieceId } from './types'

/**
 * Glass-assignment resolution (F-023). Assignments the user paints are stored on the document
 * keyed by a piece's **content id** ({@link pieceKey}) — a pure hash of its ring, so the key is
 * reproducible from geometry alone and a save/reload resolves colours directly (FR-5). Pieces the
 * user never painted inherit from their ancestor across a split/merge (FR-2) via the detector's
 * lineage.
 *
 * This module is the single source of truth for "what glass does this piece show", used by both
 * the renderer and the save-time normaliser. It is pure and framework-free: glass ids are opaque
 * strings, so `packages/core` stays free of any `@vitrum/model` dependency (the same discipline the
 * drawing tools and piece detection follow).
 */

/** The stable assignment key for a piece: the content id of its ring (reproducible on reload). */
export function pieceKey(piece: Piece): PieceId {
  return contentId(piece.ring)
}

/**
 * Resolve the effective glass of every piece in a detection generation.
 *
 * Three sources, in strict precedence:
 *
 * 1. **Direct** — the glass stored under the piece's own key, i.e. what the user painted here.
 * 2. **Symmetry** (F-052) — the effective glass of the piece this one is a live replica of, per
 *    `symLineage` (see `pieceOrbits`). Within-generation, so it resolves on a *cold* detection too:
 *    reopening a symmetric document re-derives replica colour from the source rather than needing it
 *    materialised per replica. It outranks edit inheritance deliberately — a replica must track its
 *    source's *current* colour, and the carried-forward map still holds the colour the source had
 *    before it was repainted.
 * 3. **Edit lineage** (F-023 FR-2) — the lineage ancestor's effective glass in the *previous*
 *    generation. Threading the previous generation's resolved map (`prevEffective`) makes
 *    inheritance survive a chain of edits — each generation carries forward what the one before
 *    resolved — without mutating the document on every edit.
 *
 * On a cold reload `lineage` is empty, so only direct assignments and symmetry replicas resolve —
 * which is exactly right: the save-time normaliser has materialised every live piece's glass under
 * its current content key, and replicas re-derive from their source.
 *
 * Returns a fresh map from {@link pieceKey} to glass id; pieces with none of the three are simply
 * absent (they render as "unassigned").
 */
export function resolveGeneration(
  pieces: readonly Piece[],
  lineage: Readonly<Record<PieceId, PieceId>>,
  stored: Readonly<Record<PieceId, string>>,
  prevEffective: ReadonlyMap<PieceId, string>,
  symLineage: Readonly<Record<PieceId, PieceId>> = {},
): Map<PieceId, string> {
  const effective = new Map<PieceId, string>()
  const fromEditLineage = (key: PieceId): string | undefined => {
    const ancestor = lineage[key]
    return ancestor !== undefined ? prevEffective.get(ancestor) : undefined
  }

  // Pass 1: direct assignments, plus edit inheritance for everything that is not a replica. A
  // replica's source is never itself a replica, so one deferred pass is enough — no recursion.
  const replicas: PieceId[] = []
  for (const piece of pieces) {
    const key = pieceKey(piece)
    const direct = stored[key]
    if (direct !== undefined) {
      effective.set(key, direct)
      continue
    }
    if (symLineage[key] !== undefined) {
      replicas.push(key)
      continue
    }
    const inherited = fromEditLineage(key)
    if (inherited !== undefined) effective.set(key, inherited)
  }

  // Pass 2: replicas follow their source, falling back to edit inheritance when the source itself
  // has no glass (so a replica painted before the setup changed doesn't lose its colour outright).
  for (const key of replicas) {
    const source = symLineage[key]!
    const inherited = effective.get(source) ?? fromEditLineage(key)
    if (inherited !== undefined) effective.set(key, inherited)
  }
  return effective
}
