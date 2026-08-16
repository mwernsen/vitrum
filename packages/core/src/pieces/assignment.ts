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
 * One generation's resolution: what each live piece shows, and where that value came from.
 *
 * The **origins** map is the generation's provenance, and it is the only state a caller threads
 * from one generation to the next: piece key → the *stored* key its value was read from. Values are
 * never carried forward, only the ancestry that says which document entry a piece reads — so the
 * document stays the single source of truth for the value itself (see {@link resolveGeneration}).
 */
export interface GenerationResolution {
  /** Effective value per live piece key. Pieces with no value are absent ("unassigned"). */
  readonly effective: Map<PieceId, string>
  /** Provenance: piece key → the stored key it read, which is the piece itself when painted here. */
  readonly origins: Map<PieceId, PieceId>
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
 *    source's *current* colour.
 * 3. **Edit lineage** (F-023 FR-2) — what the lineage ancestor read in the *previous* generation.
 *    Threading the previous generation's provenance (`prevOrigins`) makes inheritance survive a
 *    chain of edits — each generation carries forward which document entry the surviving piece
 *    reads — without mutating the document on every edit.
 *
 * **Provenance, not values** (fix of 2026-08-16). Inheritance carries the ancestor's *origin key*
 * and re-reads the value from `stored` every generation. Carrying the resolved value instead made
 * removal invisible: with unchanged geometry the detector's lineage maps a piece to itself, so a
 * piece whose entry the user had just cleared "inherited" the colour the previous generation had
 * resolved for it, and the colour only vanished on a geometry edit or a reload. Re-reading through
 * the origin key keeps inheritance (FR-2) while making the document authoritative for the value:
 * clear the entry and the colour goes; change it and every heir follows.
 *
 * On a cold reload `lineage` is empty, so only direct assignments and symmetry replicas resolve —
 * which is exactly right: the save-time normaliser has materialised every live piece's glass under
 * its current content key, and replicas re-derive from their source.
 */
export function resolveGeneration(
  pieces: readonly Piece[],
  lineage: Readonly<Record<PieceId, PieceId>>,
  stored: Readonly<Record<PieceId, string>>,
  prevOrigins: ReadonlyMap<PieceId, PieceId>,
  symLineage: Readonly<Record<PieceId, PieceId>> = {},
): GenerationResolution {
  const effective = new Map<PieceId, string>()
  const origins = new Map<PieceId, PieceId>()

  /** Read `origin`'s stored value for `key`; false when that entry no longer exists. */
  const read = (key: PieceId, origin: PieceId): boolean => {
    const value = stored[origin]
    if (value === undefined) return false
    effective.set(key, value)
    origins.set(key, origin)
    return true
  }
  /** The stored key this piece's lineage ancestor was reading in the previous generation. */
  const inheritedOrigin = (key: PieceId): PieceId | undefined => {
    const ancestor = lineage[key]
    return ancestor !== undefined ? prevOrigins.get(ancestor) : undefined
  }

  // Pass 1: direct assignments, plus edit inheritance for everything that is not a replica. A
  // replica's source is never itself a replica, so one deferred pass is enough — no recursion.
  const replicas: PieceId[] = []
  for (const piece of pieces) {
    const key = pieceKey(piece)
    if (read(key, key)) continue
    if (symLineage[key] !== undefined) {
      replicas.push(key)
      continue
    }
    const origin = inheritedOrigin(key)
    if (origin !== undefined) read(key, origin)
  }

  // Pass 2: replicas follow their source, falling back to edit inheritance when the source itself
  // has no glass (so a replica painted before the setup changed doesn't lose its colour outright).
  for (const key of replicas) {
    const viaSource = origins.get(symLineage[key]!)
    if (viaSource !== undefined && read(key, viaSource)) continue
    const origin = inheritedOrigin(key)
    if (origin !== undefined) read(key, origin)
  }
  return { effective, origins }
}
