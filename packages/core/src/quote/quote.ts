import { formatAreaLarge, formatLength, type LengthUnit } from '../units'
import type { BomReport } from '../bom/types'

import type {
  LaborBreakdown,
  PieceLaborRow,
  QuoteInput,
  QuoteLine,
  QuoteManualLine,
  QuoteMaterials,
  QuotePieceMetric,
  QuotePriceBook,
  QuoteReport,
} from './types'

const MM_PER_M = 1000
const G_PER_KG = 1000
/** Complexity is capped so one wild piece can't dominate the labor estimate (Decision §3). */
const MAX_COMPLEXITY = 6

/**
 * Compute the cost estimate + quote for a panel (F-056). Pure — a deterministic function of its
 * input, so the totals reproduce to the cent on a reference panel (FR-1). Material quantities and
 * glass costs come from the already-derived BOM (F-042); came/foil/solder/reinforcement/consumables
 * are priced from the {@link QuotePriceBook}; labor is estimated from per-piece metrics through the
 * transparent {@link LaborBreakdown} (FR-4). Nothing is stored — the caller re-derives on any edit
 * (FR-2). The `unit` only affects human `detail` strings; every amount is unit-independent.
 */
export function computeQuote(input: QuoteInput, unit: LengthUnit = 'mm'): QuoteReport {
  const { bom, priceBook } = input

  const materials = buildMaterials(bom, priceBook, unit)
  const labor = buildLabor(input)
  const manualLines = input.manualLines.map(toManualLine)
  const manualSubtotal = sum(manualLines.map((l) => l.amount))

  const subtotal = materials.subtotal + labor.cost + manualSubtotal
  const overhead = subtotal * input.overheadPct
  const margin = (subtotal + overhead) * input.marginPct
  const total = subtotal + overhead + margin

  return {
    currency: input.currency,
    technique: bom.technique,
    materials,
    labor,
    manualLines,
    manualSubtotal,
    subtotal,
    overheadPct: input.overheadPct,
    overhead,
    marginPct: input.marginPct,
    margin,
    total,
    hasUnpricedGlass: materials.glass.some((l) => l.unpriced),
  }
}

// --- Materials ---------------------------------------------------------------

function buildMaterials(
  bom: BomReport,
  priceBook: QuotePriceBook,
  unit: LengthUnit,
): QuoteMaterials {
  const glass: QuoteLine[] = bom.glass.map((item) => {
    const priced = item.glassId !== null && item.cost !== undefined
    const unassigned = item.glassId === null
    return {
      key: item.glassId ?? '?',
      label: `${item.code}  ${item.name}`,
      detail: unassigned
        ? `${formatAreaLarge(item.buyAreaMm2, unit)} · assign glass to price`
        : item.cost === undefined
          ? `${formatAreaLarge(item.buyAreaMm2, unit)} · no price set`
          : `${formatAreaLarge(item.buyAreaMm2, unit)}`,
      amount: priced ? item.cost! : 0,
      ...(item.glassId !== null && item.cost === undefined ? { unpriced: true } : {}),
      pieceIds: item.pieceIds,
    }
  })

  const lead: QuoteLine[] = bom.came.map((came) => {
    const metres = came.buyLengthMm / MM_PER_M
    return {
      key: came.profileId,
      label: came.name,
      detail: `${formatLength(came.buyLengthMm, unit)} × ${money(priceBook.leadPerMetre)}/m`,
      amount: metres * priceBook.leadPerMetre,
      segmentIds: came.segmentIds,
    }
  })

  const foil: QuoteLine[] = []
  if (bom.foil) {
    const tapeMetres = bom.foil.buySeamLengthMm / MM_PER_M
    foil.push({
      key: 'foil-tape',
      label: 'Copper foil tape',
      detail: `${formatLength(bom.foil.buySeamLengthMm, unit)} × ${money(priceBook.foilPerMetre)}/m`,
      amount: tapeMetres * priceBook.foilPerMetre,
      segmentIds: bom.foil.segmentIds,
    })
    const solderKg = bom.foil.solderGrams / G_PER_KG
    foil.push({
      key: 'foil-solder',
      label: 'Solder',
      detail: `${round(bom.foil.solderGrams)} g × ${money(priceBook.solderPerKg)}/kg`,
      amount: solderKg * priceBook.solderPerKg,
    })
  }

  const reinforcement: QuoteLine[] = bom.reinforcement.map((bar) => {
    const metres = bar.totalLengthMm / MM_PER_M
    return {
      key: bar.material,
      label: `${bar.material} bar (${bar.count})`,
      detail: `${formatLength(bar.totalLengthMm, unit)} × ${money(priceBook.reinforcementPerMetre)}/m`,
      amount: metres * priceBook.reinforcementPerMetre,
    }
  })

  const consumables: QuoteLine[] = priceBook.consumables.map((c) => ({
    key: c.id,
    label: c.name,
    detail: 'per panel',
    amount: c.cost,
  }))

  const subtotal = sum(
    [...glass, ...lead, ...foil, ...reinforcement, ...consumables].map((l) => l.amount),
  )
  return { glass, lead, foil, reinforcement, consumables, subtotal }
}

// --- Labor -------------------------------------------------------------------

function buildLabor(input: QuoteInput): LaborBreakdown {
  const { labor, bom } = input
  const pieceFactor = bom.technique === 'foil' ? labor.foilPieceFactor : 1

  const perPiece: PieceLaborRow[] = input.pieces
    .map((metric) => {
      const complexity = pieceComplexity(metric)
      const minutes =
        pieceFactor * (labor.minutesPerPiece + labor.minutesPerComplexity * complexity)
      return {
        contentId: metric.contentId,
        pieceId: metric.pieceId,
        label: metric.label,
        glassId: metric.glassId,
        areaMm2: metric.areaMm2,
        complexity,
        minutes,
        cost: (minutes / 60) * labor.hourlyRate,
      }
    })
    // Smallest pieces first — the sensitivity view ("the N smallest pieces contribute €Y", FR-6).
    // Tie-break on content id so the order is deterministic (FR-1).
    .sort((a, b) => a.areaMm2 - b.areaMm2 || (a.contentId < b.contentId ? -1 : 1))

  const pieceMinutes = sum(perPiece.map((p) => p.minutes))
  const pieceHours = pieceMinutes / 60

  // Seam metres: the net (real) seam length — came for lead, copper-foil seam for foil.
  const seamLengthMm =
    bom.technique === 'foil'
      ? (bom.foil?.netSeamLengthMm ?? 0)
      : sum(bom.came.map((c) => c.netLengthMm))
  const seamMetres = seamLengthMm / MM_PER_M
  const seamHours = (labor.minutesPerSeamMetre * seamMetres) / 60

  const setupHours = labor.setupHours
  const hours = setupHours + pieceHours + seamHours

  return {
    hourlyRate: labor.hourlyRate,
    setupHours,
    setupCost: setupHours * labor.hourlyRate,
    pieceHours,
    pieceCost: pieceHours * labor.hourlyRate,
    seamMetres,
    seamHours,
    seamCost: seamHours * labor.hourlyRate,
    hours,
    cost: hours * labor.hourlyRate,
    pieceFactor,
    perPiece,
  }
}

/**
 * A piece's shape complexity (Decision §3): how much longer its boundary is than its bounding box,
 * clamped to a sane range. `0` for a rectangle-ish piece; higher for a wiggly, curve-heavy piece,
 * which therefore costs more per-piece labor ("curve-heavy pieces cut slower"). Purely geometric and
 * deterministic — no dependency on how the boundary is drawn.
 */
export function pieceComplexity(metric: QuotePieceMetric): number {
  const bboxPerimeter = 2 * (metric.bboxWidthMm + metric.bboxHeightMm)
  if (bboxPerimeter <= 0) return 0
  const raw = metric.perimeterMm / bboxPerimeter - 1
  return Math.max(0, Math.min(MAX_COMPLEXITY, raw))
}

// --- Helpers -----------------------------------------------------------------

function toManualLine(line: QuoteManualLine): QuoteLine {
  return { key: line.id, label: line.description || 'Line item', detail: '', amount: line.amount }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, v) => total + v, 0)
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** Format a bare money amount (no currency symbol — the caller prefixes the symbol). */
function money(n: number): string {
  return round(n).toString()
}
