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
 * A piece shows its **directly stored** glass if the user painted it; otherwise it **inherits**
 * from its lineage ancestor's effective glass in the *previous* generation. Threading the previous
 * generation's resolved map (`prevEffective`) makes inheritance survive a chain of edits — each
 * generation carries forward what the one before resolved — without mutating the document on every
 * edit. On a cold detection (no previous, empty lineage) only direct assignments resolve, which is
 * exactly the reload path: the save-time normaliser will have materialised every live piece's glass
 * under its current content key.
 *
 * Returns a fresh map from {@link pieceKey} to glass id; pieces with neither a direct nor an
 * inherited glass are simply absent (they render as "unassigned").
 */
export function resolveGeneration(
  pieces: readonly Piece[],
  lineage: Readonly<Record<PieceId, PieceId>>,
  stored: Readonly<Record<PieceId, string>>,
  prevEffective: ReadonlyMap<PieceId, string>,
): Map<PieceId, string> {
  const effective = new Map<PieceId, string>()
  for (const piece of pieces) {
    const key = pieceKey(piece)
    const direct = stored[key]
    if (direct !== undefined) {
      effective.set(key, direct)
      continue
    }
    const ancestor = lineage[key]
    const inherited = ancestor !== undefined ? prevEffective.get(ancestor) : undefined
    if (inherited !== undefined) effective.set(key, inherited)
  }
  return effective
}
