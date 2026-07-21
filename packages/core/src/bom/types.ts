import type { BBox, Vec2 } from '@vitrum/geometry'

import type { CutContour } from '../technique/types'
import type { Piece, PieceId, PieceSegment } from '../pieces/types'
import type { TechniqueSettings } from '../technique/types'

/**
 * Cutting list & bill of materials (F-042): the workshop paperwork, derived — always in sync — from
 * the lead-line network plus technique, glass, numbering and reinforcement (the EDA "BOM regenerates
 * from the netlist" idea). Everything here is pure data plus one free function ({@link computeBom}),
 * with no DOM, Svelte or `@vitrum/model` dependency — the model types it needs (glass, reinforcement)
 * are mirrored structurally, exactly as `technique` and `pieces` mirror them, so the calc stays a
 * unit-testable function of geometry-derived inputs (FR-1). The UI snapshots its live derived data
 * into a {@link BomInput}; `@vitrum/paper` turns the resulting {@link BomReport} into a PDF/CSV.
 *
 * Areas are mm²; lengths mm. Formatting into the display unit is the caller's job (`formatArea`,
 * `formatLength`).
 */

/** A glass as the BOM sees it — a structural subset of `@vitrum/model`'s `Glass`. */
export interface BomGlass {
  readonly id: string
  readonly name: string
  /** Base colour (CSS hex) — printed as the swatch on the cutting list (FR-4). */
  readonly color?: string
  readonly thicknessMm?: number
  readonly manufacturer?: string
  readonly sku?: string
  /** Price per square metre, in the project's currency (F-022). */
  readonly pricePerM2?: number
  readonly sheetSizes?: readonly {
    readonly widthMm: number
    readonly heightMm: number
    readonly label?: string
  }[]
}

/** A reinforcement bar as the BOM sees it — a structural subset of `@vitrum/model`'s `ReinforcementBar`. */
export interface BomReinforcement {
  readonly id: string
  readonly a: Vec2
  readonly b: Vec2
  readonly widthMm: number
  readonly material: string
}

/** Weight breakdown (grams), from F-032's `panelWeight` (the caller injects it, so `core` stays leaf). */
export interface BomWeight {
  readonly grams: number
  readonly glassGrams: number
  readonly leadGrams: number
}

/** Estimation factors (F-042 FR-5) — a structural mirror of `@vitrum/model`'s `BomSettings`. */
export interface BomFactors {
  readonly glassWaste: number
  readonly leadWaste: number
  readonly solderGramsPerMetre: number
  readonly foilRollLengthMm: number
}

/** Everything {@link computeBom} needs. All maps are keyed by a piece's **content id** (`pieceKey`). */
export interface BomInput {
  readonly technique: TechniqueSettings
  readonly pieces: readonly Piece[]
  /** Technique-derived cut contours (F-021), keyed internally by `CutContour.pieceId` (display id). */
  readonly cutContours: readonly CutContour[]
  /** Output segments (construction guides already excluded by the caller). */
  readonly segments: readonly PieceSegment[]
  readonly glasses: Readonly<Record<string, BomGlass>>
  /** Short code per glass id (F-040 legend), e.g. `A`, `B`. */
  readonly glassCodes: Readonly<Record<string, string>>
  /** Effective glass per piece content id (direct or inherited); absent ⇒ unassigned. */
  readonly glassByPiece: Readonly<Record<PieceId, string>>
  /** Effective number/label per piece content id; absent ⇒ unnumbered. */
  readonly labelByPiece: Readonly<Record<PieceId, string>>
  readonly reinforcements: readonly BomReinforcement[]
  readonly factors: BomFactors
  readonly weight: BomWeight
}

/** One piece in the cutting list: its number, cut-contour bounding box and cut-contour area. */
export interface CutListRow {
  /** Piece content id (`pieceKey`) — the stable key. */
  readonly contentId: PieceId
  /** Piece display id — what the canvas highlights when this row is picked (traceability). */
  readonly pieceId: string
  /** Effective number (empty string when the piece is unnumbered). */
  readonly label: string
  /** Cut-contour bounding-box width and height (mm) — the glass to cut, not the drawn shape. */
  readonly widthMm: number
  readonly heightMm: number
  /** Cut-contour area (mm²), holes subtracted. */
  readonly areaMm2: number
  /** True when the cut contour degenerated (piece too small to inset) — area falls back to the piece. */
  readonly degenerate: boolean
}

/** One glass section of the cutting list: all its pieces, with a waste-inflated "buy this much". */
export interface CutListGroup {
  /** Glass id, or null for the unassigned bucket. */
  readonly glassId: string | null
  readonly code: string
  readonly name: string
  readonly color?: string
  readonly manufacturer?: string
  readonly rows: readonly CutListRow[]
  readonly count: number
  /** Sum of the pieces' cut-contour areas (mm²). */
  readonly netAreaMm2: number
  /** Net area × (1 + glass waste) — the "buy this much" figure (mm²). */
  readonly buyAreaMm2: number
  /** Piece display ids in this group (traceability: highlight all pieces of a glass). */
  readonly pieceIds: readonly string[]
}

/** A sheet suggestion for a glass line item (F-022 sheet sizes). */
export interface SheetSuggestion {
  readonly widthMm: number
  readonly heightMm: number
  readonly label?: string
  /** Whole sheets of this size needed to cover the buy area. */
  readonly sheetsNeeded: number
}

/** One glass line item of the BOM: area, sheet suggestion and price. */
export interface GlassBomItem {
  readonly glassId: string | null
  readonly code: string
  readonly name: string
  readonly color?: string
  readonly manufacturer?: string
  readonly count: number
  readonly netAreaMm2: number
  readonly buyAreaMm2: number
  /** Suggested sheet + count, when the glass carries sheet sizes. */
  readonly sheet?: SheetSuggestion
  /** Estimated cost of the buy area at the glass's price per m², when priced. */
  readonly cost?: number
  readonly pieceIds: readonly string[]
}

/** One came line item of the BOM: a came profile with its total length (lead technique). */
export interface CameBomItem {
  readonly profileId: string
  readonly name: string
  readonly kind: 'H' | 'U'
  readonly flangeMm: number
  readonly heartMm: number
  /** Total came length (mm), summed over the network so each interior lead line counts once (FR-1). */
  readonly netLengthMm: number
  /** Net length × (1 + lead waste). */
  readonly buyLengthMm: number
  readonly segmentIds: readonly string[]
}

/** The copper-foil line item of the BOM (foil technique). */
export interface FoilBomItem {
  /** Total seam length (mm), each network segment counted once. */
  readonly netSeamLengthMm: number
  /** Net seam length × (1 + foil waste). */
  readonly buySeamLengthMm: number
  readonly rollLengthMm: number
  /** Whole rolls needed to cover the buy length. */
  readonly rollsNeeded: number
  /** Documented solder rule of thumb (g per metre of seam). */
  readonly solderGramsPerMetre: number
  /** Estimated solder mass (g) = solderGramsPerMetre × net seam length in metres. */
  readonly solderGrams: number
  readonly segmentIds: readonly string[]
}

/** One reinforcement line item of the BOM: bars grouped by material. */
export interface ReinforcementBomItem {
  readonly material: string
  readonly count: number
  readonly totalLengthMm: number
  readonly barIds: readonly string[]
}

/** The full cutting list + bill of materials for a panel. */
export interface BomReport {
  readonly technique: 'lead' | 'foil'
  /** Cutting list: one section per glass (FR-4 "one glass per section"). */
  readonly cutting: readonly CutListGroup[]
  /** Glass line items (purchasing view). */
  readonly glass: readonly GlassBomItem[]
  /** Came line items — non-empty only in lead technique. */
  readonly came: readonly CameBomItem[]
  /** Copper-foil line item — present only in foil technique. */
  readonly foil: FoilBomItem | null
  /** Reinforcement line items (grouped by material). */
  readonly reinforcement: readonly ReinforcementBomItem[]
  readonly weight: BomWeight
  readonly factors: BomFactors
  /** Total detected pieces (whether assigned or not). */
  readonly pieceCount: number
}

export type { BBox }
