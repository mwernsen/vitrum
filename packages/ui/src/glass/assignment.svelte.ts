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

  /**
   * Recompute the effective map. Call in an effect whenever detection or the stored assignments
   * change. `genToken` identifies the detection generation (pass the `DetectionResult` object): it
   * advances the inheritance base **only** when geometry actually changed, so re-running for a mere
   * paint (same geometry) still resolves splits/merges from the correct previous generation. `stored`
   * is `doc.assignments`.
   */
  update(
    genToken: unknown,
    pieces: readonly Piece[],
    lineage: DetectionResult['lineage'],
    stored: Readonly<Record<PieceId, GlassId>>,
  ): void {
    if (!this.#primed || genToken !== this.#token) {
      this.#primed = true
      this.#token = genToken
      this.#prevGen = this.#lastGen
    }
    this.#lastGen = resolveGeneration(pieces, lineage, stored, this.#prevGen)
    this.effective = this.#lastGen
  }

  /** Discard carried-forward state (on loading a different document). */
  reset(): void {
    this.#prevGen = new SvelteMap()
    this.#lastGen = new SvelteMap()
    this.#token = undefined
    this.#primed = false
    this.effective = new SvelteMap()
  }

  /** The effective glass id of a piece, or undefined when unassigned. */
  glassFor(piece: Piece): GlassId | undefined {
    return this.effective.get(pieceKey(piece))
  }

  setSelectedGlass(id: GlassId | null): void {
    this.selectedGlassId = id
  }
}
