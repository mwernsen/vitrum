import {
  labelPlacement,
  pieceKey,
  resolveGeneration,
  type LabelPlacement,
  type NumberingScheme,
  type Piece,
  type PieceId,
} from '@vitrum/core'
import type { NumberingState } from '@vitrum/model'
import { SvelteMap } from 'svelte/reactivity'

/**
 * One generation-threaded resolution of a stored `contentId → value` map (F-040). Mirrors the
 * inheritance F-023's {@link resolveGeneration} does for glass: a reshaped piece (whose content id
 * changed) inherits its value from its lineage ancestor, so the value stays attached to the surviving
 * piece; a genuinely new piece has no ancestor and resolves to nothing. The "previous generation"
 * base only advances when geometry actually changed (gated by the caller's generation token).
 *
 * What is carried forward is **provenance** (which stored entry a surviving piece reads), not the
 * resolved value — so clearing an entry takes effect immediately rather than being inherited back
 * from the previous generation (see F-023's 2026-08-16 fix note).
 */
class Pipeline {
  #prev: ReadonlyMap<PieceId, PieceId> = new Map()
  #last: ReadonlyMap<PieceId, PieceId> = new Map()

  resolve(
    pieces: readonly Piece[],
    lineage: Readonly<Record<PieceId, PieceId>>,
    stored: Readonly<Record<PieceId, string>>,
    advance: boolean,
  ): Map<PieceId, string> {
    if (advance) this.#prev = this.#last
    const { effective, origins } = resolveGeneration(pieces, lineage, stored, this.#prev)
    this.#last = origins
    return effective
  }

  reset(): void {
    this.#prev = new Map()
    this.#last = new Map()
  }
}

/**
 * The reactive resolver for piece numbering (F-040). The document stores the materialised numbers
 * (keyed by piece content id): `auto` from the last renumber and manual `overrides`. This controller
 * turns those, plus the detector's lineage, into each live piece's **effective** number — the value
 * the cartoon, the number overlay, the inspector and the readiness strip read. Numbers stay attached
 * to surviving pieces across geometry edits (FR-3) via generational inheritance, exactly as glass
 * assignments do; they are not written back on every edit (the save-time normaliser materialises them
 * — see the shell).
 *
 * Two maps are resolved so the manual/auto distinction survives edits: `overrides` win over `auto`,
 * and a renumber (which only rewrites `auto`) leaves overrides in place (FR-1). A piece with neither
 * an override nor an auto label is **unnumbered** until the next renumber.
 */
export class NumberingController {
  /** The active scheme (mirrors `doc.numbering.scheme`), for the panel's selector. */
  scheme = $state<NumberingScheme>('grouped')
  /** Effective number per live piece (override ?? auto), keyed by {@link pieceKey} (content id). */
  labels = $state<Map<PieceId, string>>(new SvelteMap())
  /** Where each live piece's number is drawn (pole of inaccessibility + inscribed radius). */
  placements = $state<Map<PieceId, LabelPlacement>>(new SvelteMap())

  /** Effective auto labels (resolved), for renumber and save-time normalisation. */
  effectiveAuto = $state<Map<PieceId, string>>(new SvelteMap())
  /** Effective overrides (resolved), for renumber and save-time normalisation. */
  effectiveOverrides = $state<Map<PieceId, string>>(new SvelteMap())

  readonly #auto = new Pipeline()
  readonly #overrides = new Pipeline()
  #token: unknown = undefined
  #primed = false

  /**
   * Recompute the effective maps. Call in an effect whenever detection or the stored numbering
   * changes. `genToken` identifies the detection generation (pass the `DetectionResult` object): it
   * advances the inheritance base only when geometry actually changed, so a mere renumber (same
   * geometry) still resolves inheritance from the correct previous generation.
   */
  update(
    genToken: unknown,
    pieces: readonly Piece[],
    lineage: Readonly<Record<PieceId, PieceId>>,
    numbering: NumberingState,
  ): void {
    const advance = !this.#primed || genToken !== this.#token
    if (advance) {
      this.#primed = true
      this.#token = genToken
    }
    const auto = this.#auto.resolve(pieces, lineage, numbering.auto, advance)
    const overrides = this.#overrides.resolve(pieces, lineage, numbering.overrides, advance)

    const labels = new SvelteMap<PieceId, string>()
    const placements = new SvelteMap<PieceId, LabelPlacement>()
    for (const piece of pieces) {
      const key = pieceKey(piece)
      const label = overrides.get(key) ?? auto.get(key)
      if (label !== undefined) labels.set(key, label)
      placements.set(key, labelPlacement(piece))
    }
    this.effectiveAuto = new SvelteMap(auto)
    this.effectiveOverrides = new SvelteMap(overrides)
    this.labels = labels
    this.placements = placements
    this.scheme = numbering.scheme
  }

  /** Discard carried-forward state (on loading a different document). */
  reset(): void {
    this.#auto.reset()
    this.#overrides.reset()
    this.#token = undefined
    this.#primed = false
    this.effectiveAuto = new SvelteMap()
    this.effectiveOverrides = new SvelteMap()
    this.labels = new SvelteMap()
    this.placements = new SvelteMap()
  }

  /** The effective number of a piece, or undefined when unnumbered. */
  labelFor(piece: Piece): string | undefined {
    return this.labels.get(pieceKey(piece))
  }

  /** Number of live pieces with no effective number (FR-3 "unnumbered until renumber"). */
  unnumberedCount(pieces: readonly Piece[]): number {
    let n = 0
    for (const piece of pieces) if (this.labelFor(piece) === undefined) n += 1
    return n
  }
}
