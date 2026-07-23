import type { BomReport } from '../bom/types'

/**
 * Cost estimation & quoting (F-056): turn the BOM into money. `computeQuote` is a pure, deterministic
 * function of its input (FR-1) — no DOM, Svelte or `@vitrum/model` dependency: the model types it
 * needs (currency, price book, labor model, manual lines) are mirrored structurally here, exactly as
 * `@vitrum/core`'s BOM mirrors glass/reinforcement, so the calc stays a unit-testable function of the
 * derived design metrics. The UI snapshots its live document + BOM into a {@link QuoteInput};
 * `@vitrum/paper` turns the resulting {@link QuoteReport} into a client quote PDF.
 *
 * All amounts are plain numbers in the project currency (no conversion). Rounding to the cent is the
 * caller's presentation job; the report carries raw values so subtotals stay exact (FR-1).
 */

/** Currency for display — a structural mirror of `@vitrum/model`'s `Currency`. */
export interface QuoteCurrency {
  readonly code: string
  readonly symbol: string
}

/** One consumable line — a structural mirror of `@vitrum/model`'s `ConsumableLine`. */
export interface QuoteConsumable {
  readonly id: string
  readonly name: string
  readonly cost: number
}

/** Unit prices for the linear/mass materials — a structural mirror of `@vitrum/model`'s `PriceBook`. */
export interface QuotePriceBook {
  readonly leadPerMetre: number
  readonly foilPerMetre: number
  readonly solderPerKg: number
  readonly reinforcementPerMetre: number
  readonly consumables: readonly QuoteConsumable[]
}

/** Labor-estimation coefficients — a structural mirror of `@vitrum/model`'s `LaborModel`. */
export interface QuoteLaborModel {
  readonly hourlyRate: number
  readonly setupHours: number
  readonly minutesPerPiece: number
  readonly minutesPerSeamMetre: number
  readonly minutesPerComplexity: number
  readonly foilPieceFactor: number
}

/** A manual quote line — a structural mirror of `@vitrum/model`'s `QuoteLineItem`. */
export interface QuoteManualLine {
  readonly id: string
  readonly description: string
  readonly amount: number
}

/**
 * Per-piece design metrics the labor model consumes (F-056). The caller derives these from the live
 * F-020 pieces; {@link computeQuote} turns them into per-piece labor time (and shape complexity)
 * deterministically, so the sensitivity view and totals are reproducible (FR-1/FR-6).
 */
export interface QuotePieceMetric {
  /** Piece content id (stable key). */
  readonly contentId: string
  /** Piece display id — what the canvas highlights for the sensitivity view (traceability). */
  readonly pieceId: string
  /** Effective number/label (empty when unnumbered). */
  readonly label: string
  /** Effective glass id, or null when unassigned. */
  readonly glassId: string | null
  /** Cut-contour (or piece) area in mm². */
  readonly areaMm2: number
  /** Piece boundary perimeter in mm (outer + holes). */
  readonly perimeterMm: number
  /** Bounding-box width/height in mm — the complexity baseline. */
  readonly bboxWidthMm: number
  readonly bboxHeightMm: number
}

/** Everything {@link computeQuote} needs. */
export interface QuoteInput {
  /** The live cutting list / BOM (F-042): material quantities + glass costs from `pricePerM2`. */
  readonly bom: BomReport
  readonly currency: QuoteCurrency
  readonly priceBook: QuotePriceBook
  readonly labor: QuoteLaborModel
  /** Overhead markup on the cost subtotal (fraction). */
  readonly overheadPct: number
  /** Margin markup on subtotal + overhead (fraction). */
  readonly marginPct: number
  readonly manualLines: readonly QuoteManualLine[]
  /** Per-piece metrics for the labor model + sensitivity view. */
  readonly pieces: readonly QuotePieceMetric[]
}

/** One priced line in the quote (material, consumable or manual). */
export interface QuoteLine {
  /** Stable key for rendering + traceability. */
  readonly key: string
  readonly label: string
  /** Human detail (quantity, unit price), shown small next to the amount. */
  readonly detail: string
  /** Amount in the project currency. */
  readonly amount: number
  /** True when a glass in use has no `pricePerM2` — the amount is 0 and the total understates. */
  readonly unpriced?: boolean
  /** Contributing piece display ids (traceability: highlight on canvas). */
  readonly pieceIds?: readonly string[]
  /** Contributing segment ids (came/foil traceability). */
  readonly segmentIds?: readonly string[]
}

/** One piece's labor contribution — the sensitivity view's unit (FR-6). */
export interface PieceLaborRow {
  readonly contentId: string
  readonly pieceId: string
  readonly label: string
  readonly glassId: string | null
  readonly areaMm2: number
  /** Shape complexity ≥ 0 (0 ≈ rectangle; higher = curve-heavy). */
  readonly complexity: number
  /** Estimated minutes to cut + fit this piece. */
  readonly minutes: number
  /** Per-piece labor cost = minutes / 60 × hourly rate. */
  readonly cost: number
}

/** The transparent labor breakdown (F-056 FR-4): hours per factor, resolved to cost. */
export interface LaborBreakdown {
  readonly hourlyRate: number
  readonly setupHours: number
  readonly setupCost: number
  readonly pieceHours: number
  readonly pieceCost: number
  readonly seamMetres: number
  readonly seamHours: number
  readonly seamCost: number
  /** Total estimated hours (setup + pieces + seam). */
  readonly hours: number
  /** Total labor cost. */
  readonly cost: number
  /** Per-piece factor applied (foilPieceFactor for foil, else 1). */
  readonly pieceFactor: number
  /** Per-piece rows, ordered by area ascending (smallest first) for the sensitivity view. */
  readonly perPiece: readonly PieceLaborRow[]
}

/** Materials grouped for the quote, plus the materials subtotal. */
export interface QuoteMaterials {
  readonly glass: readonly QuoteLine[]
  /** Came line items (lead technique); empty in foil technique. */
  readonly lead: readonly QuoteLine[]
  /** Copper-foil + solder line items (foil technique); empty in lead technique. */
  readonly foil: readonly QuoteLine[]
  readonly reinforcement: readonly QuoteLine[]
  readonly consumables: readonly QuoteLine[]
  readonly subtotal: number
}

/** The full quote: materials + labor + manual lines, with overhead, margin and grand total. */
export interface QuoteReport {
  readonly currency: QuoteCurrency
  readonly technique: 'lead' | 'foil'
  readonly materials: QuoteMaterials
  readonly labor: LaborBreakdown
  readonly manualLines: readonly QuoteLine[]
  readonly manualSubtotal: number
  /** Cost subtotal = materials + labor + manual. */
  readonly subtotal: number
  readonly overheadPct: number
  readonly overhead: number
  readonly marginPct: number
  readonly margin: number
  /** Grand total = subtotal + overhead + margin. */
  readonly total: number
  /** True when a glass in use has no price — the total understates real material cost (FR-5). */
  readonly hasUnpricedGlass: boolean
}
