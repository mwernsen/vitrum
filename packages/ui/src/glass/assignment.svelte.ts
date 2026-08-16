import { pieceKey, resolveGeneration, type DetectionResult, type Piece } from '@vitrum/core'
import type { GlassId, PieceId } from '@vitrum/model'
import { SvelteMap } from 'svelte/reactivity'

/**
 * The reactive resolver for glass assignments (F-023). The document stores only the glass the user
 * explicitly painted (keyed by piece content id); this controller turns that plus the detector's
 * lineage into the **effective** glass of every live piece — the value the renderer, the inspector
 * and the status bar read. Inheritance across splits/merges is resolved live (FR-2) by threading the
 * previous generation's resolved map through {@link resolveGeneration}; it is not written back to the
 * document on every edit (the save-time normaliser materialises it — see the document controller).
 *
 * Under live symmetry (F-052) it also resolves each replica piece's colour from the piece it
 * repeats, using the generation's symmetry orbits — so painting the source sector colours the whole
 * rosette, and reopening the file re-derives it. It owns the replica → source map the paint tool
 * needs to write **through** a replica to its source (see {@link representativeOf}).
 *
 * It also owns the **selected glass** — the one the paint tool assigns — since that is transient UI
 * state, not part of the document/undo model.
 */
export class AssignmentController {
  /** Effective glass per live piece, keyed by {@link pieceKey} (content id). */
  effective = $state<Map<PieceId, GlassId>>(new SvelteMap())
  /** The glass the paint tool assigns on click, or null when none is chosen. */
  selectedGlassId = $state<GlassId | null>(null)

  /** The previous *generation's* resolved map — the base inheritance resolves against. */
  #prevGen: Map<PieceId, GlassId> = new SvelteMap()
  /** This generation's resolved map (becomes `#prevGen` when the generation changes). */
  #lastGen: Map<PieceId, GlassId> = new SvelteMap()
  /** Identity of the current detection generation; advancing it is what carries inheritance. */
  #token: unknown = undefined
  #primed = false

  /** This generation's symmetry orbits (F-052): replica key → the source key it repeats. */
  #symLineage: Readonly<Record<PieceId, PieceId>> = {}
  /**
   * The inverse of {@link #symLineage}: source key → every replica key that follows it. A plain
   * record, not a `Map` — it is a derived lookup index, never read reactively.
   */
  #replicasBySource: Record<PieceId, PieceId[]> = {}
  /** The document's stored assignments, so callers can tell a direct entry from an inherited one. */
  #stored: Readonly<Record<PieceId, GlassId>> = {}

  /**
   * Recompute the effective map. Call in an effect whenever detection or the stored assignments
   * change. `detection` identifies the detection generation (pass the `DetectionResult`): its object
   * identity advances the inheritance base **only** when geometry actually changed, so re-running for
   * a mere paint (same geometry) still resolves splits/merges from the correct previous generation.
   * It also carries the generation's symmetry orbits (F-052). `stored` is `doc.assignments`.
   */
  update(
    detection: Pick<DetectionResult, 'symLineage'> | null | undefined,
    pieces: readonly Piece[],
    lineage: DetectionResult['lineage'],
    stored: Readonly<Record<PieceId, GlassId>>,
  ): void {
    if (!this.#primed || detection !== this.#token) {
      this.#primed = true
      this.#token = detection
      this.#prevGen = this.#lastGen
    }
    this.#stored = stored
    this.#symLineage = detection?.symLineage ?? {}
    this.#replicasBySource = {}
    for (const [replica, source] of Object.entries(this.#symLineage)) {
      const list = this.#replicasBySource[source]
      if (list) list.push(replica)
      else this.#replicasBySource[source] = [replica]
    }
    this.#lastGen = resolveGeneration(pieces, lineage, stored, this.#prevGen, this.#symLineage)
    this.effective = this.#lastGen
  }

  /** Discard carried-forward state (on loading a different document). */
  reset(): void {
    this.#prevGen = new SvelteMap()
    this.#lastGen = new SvelteMap()
    this.#token = undefined
    this.#primed = false
    this.#symLineage = {}
    this.#replicasBySource = {}
    this.#stored = {}
    this.effective = new SvelteMap()
  }

  /** The effective glass id of a piece, or undefined when unassigned. */
  glassFor(piece: Piece): GlassId | undefined {
    return this.effective.get(pieceKey(piece))
  }

  setSelectedGlass(id: GlassId | null): void {
    this.selectedGlassId = id
  }

  // --- Symmetry orbits (F-052) ----------------------------------------------

  /** True when this piece is a live symmetry replica of another piece rather than a source piece. */
  isReplica(key: PieceId): boolean {
    return this.#symLineage[key] !== undefined
  }

  /**
   * Where a paint on this piece should be **stored**: the source piece of its symmetry orbit, or the
   * piece itself when it isn't a replica. Replicas are derived output (F-052 Decision §2) — painting
   * one writes through to the source, which is what makes the colour follow every sector.
   */
  representativeOf(key: PieceId): PieceId {
    return this.#symLineage[key] ?? key
  }

  /**
   * The replica keys in `source`'s orbit that carry a **direct** stored assignment. Writing the
   * source's glass must clear these, or a stale per-replica entry (a file painted sector-by-sector
   * before symmetry inheritance existed, or materialised by the save-time normaliser) would outrank
   * the source and the paint would appear to do nothing in that sector.
   */
  staleReplicasOf(source: PieceId): PieceId[] {
    const replicas = this.#replicasBySource[source]
    if (!replicas) return []
    return replicas.filter((key) => this.#stored[key] !== undefined)
  }
}
