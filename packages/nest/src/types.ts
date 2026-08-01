import type { Vec2 } from '@vitrum/geometry'

/**
 * Sheet nesting (F-057): lay each glass's cut pieces onto real sheets to minimise waste. Everything
 * here is pure data plus free functions — no DOM, no Svelte, no `@vitrum/model` dependency. The
 * engine consumes a structural view of the pieces ({@link NestPart}) that the UI builds from F-020
 * pieces + F-023 assignments + F-040 numbering, so `packages/nest` stays document-independent (the
 * same pattern piece detection and DRC use).
 *
 * The nested layout is a **derived output**: given the same {@link NestInput} (including its seed) the
 * result is byte-for-byte reproducible (FR-3). Only the tunable intent (spacing, seed, per-glass
 * sheet/rotation) is ever persisted, on the document.
 */

/**
 * How a glass's pieces may be rotated when nested. Streaky/directional glass is grain-constrained to
 * `flip` (0/180°) so the streak is preserved, or `fixed` (0°); isotropic glass can use `quadrant`
 * (0/90/180/270°) or `free` (finer angles). Mirrors `@vitrum/model`'s `NestRotationPolicy`.
 */
export type NestRotationPolicy = 'free' | 'quadrant' | 'flip' | 'fixed'

/**
 * How pieces are ordered onto the sheets. Every strategy still prefers fewer sheets — for a fixed
 * set of pieces on a fixed sheet size, utilisation *is* one over the sheet count, so nothing trades
 * that away. What differs is the placement order, which changes how the offcuts fall and how the
 * cuts run:
 *
 * - `fewest` — biggest area first. The best sheet count on most panels, at the cost of awkward
 *   offcuts. The default, and what the nester has always done.
 * - `tight` — tallest first, so pieces band into shelves of similar height and the leftover strips
 *   are usable; cut directions end up mixed.
 * - `fast` — widest first, so pieces line up in long rows and more scores run straight across.
 */
export type NestStrategy = 'fewest' | 'tight' | 'fast'

/** A commercial sheet dimension pieces are laid onto (mm). */
export interface NestSheetSize {
  readonly widthMm: number
  readonly heightMm: number
  readonly label?: string
}

/**
 * One piece to place: its flattened outer ring and holes in mm (F-020 `Piece.ring`/`holeRings`),
 * tagged with the glass it is cut from and the label to print on the layout (its F-040 number).
 */
export interface NestPart {
  readonly id: string
  readonly label: string
  readonly glassId: string
  readonly ring: readonly Vec2[]
  readonly holes: readonly (readonly Vec2[])[]
}

/** Per-glass nesting choices as the engine consumes them: the resolved sheet and rotation policy. */
export interface NestGlassInput {
  readonly glassId: string
  readonly sheet: NestSheetSize
  readonly rotation: NestRotationPolicy
}

/** The whole nesting problem. */
export interface NestInput {
  readonly parts: readonly NestPart[]
  readonly glasses: readonly NestGlassInput[]
  /** Cut allowance kept between pieces and from the sheet edge, in mm. */
  readonly spacingMm: number
  /** Seed for the stochastic placement — the same seed always yields the same layout (FR-3). */
  readonly seed: number
  /** Placement order. Defaults to `fewest` — the ordering the nester has always used. */
  readonly strategy?: NestStrategy
  /** Target upper bound on raster cells per sheet (tunes speed vs. tightness). Default 200 000. */
  readonly maxCellsPerSheet?: number
}

/**
 * A piece placed on a sheet. `ring`/`holes` are the final placed polygons in sheet mm (the source
 * outline rotated by `rotationDeg` about the origin, then translated by `offset`) — ready to render
 * or export. `area` is the piece area (holes subtracted); it is rotation/translation invariant.
 */
export interface PlacedPart {
  readonly id: string
  readonly label: string
  readonly rotationDeg: number
  readonly offset: Vec2
  readonly ring: readonly Vec2[]
  readonly holes: readonly (readonly Vec2[])[]
  readonly area: number
}

/** One physical sheet with its placed pieces and utilisation (placed area / sheet area, [0,1]). */
export interface NestSheet {
  readonly glassId: string
  readonly index: number
  readonly widthMm: number
  readonly heightMm: number
  readonly label?: string
  readonly parts: readonly PlacedPart[]
  readonly utilization: number
}

/** The nesting outcome for one glass. */
export interface GlassNestResult {
  readonly glassId: string
  readonly sheets: readonly NestSheet[]
  readonly sheetCount: number
  /** Ids of parts that fit no sheet (larger than the sheet even rotated). */
  readonly unplaced: readonly string[]
  /** Total placed area / total sheet area across this glass's sheets, in [0,1]. */
  readonly utilization: number
}

/** The full result: one entry per glass, plus the grand total sheet count. */
export interface NestResult {
  readonly seed: number
  readonly glasses: readonly GlassNestResult[]
  readonly totalSheets: number
}

/** Progress emitted during a run (for the worker's progress UI). Never affects the result. */
export interface NestProgress {
  /** Fraction complete in [0,1]. */
  readonly fraction: number
  /** The glass currently being nested, or null when the run is done. */
  readonly glassId: string | null
  /** Sheets opened so far across all glasses. */
  readonly sheets: number
}
