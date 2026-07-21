import { curveLength } from '@vitrum/geometry'

import { pieceKey } from '../pieces/assignment'
import type { Piece } from '../pieces/types'
import { resolveCame } from '../technique/allowance'
import type { CutContour } from '../technique/types'

import type {
  BomInput,
  BomReport,
  CameBomItem,
  CutListGroup,
  CutListRow,
  FoilBomItem,
  GlassBomItem,
  ReinforcementBomItem,
  SheetSuggestion,
} from './types'

/** The unassigned-glass bucket's code — mirrors F-040's `UNASSIGNED_CODE`. */
const UNASSIGNED_CODE = '?'
const MM_PER_M = 1000

/**
 * Compute the cutting list and bill of materials for a panel (F-042). Pure — a deterministic function
 * of its input, so the totals can be checked against hand-computed values in a unit test (FR-1). The
 * lists are always derived here from the current geometry/technique/glass, never stored, so any edit
 * that changes the input yields a fresh report (FR-2).
 */
export function computeBom(input: BomInput): BomReport {
  const cutByPiece = new Map<string, CutContour>()
  for (const cut of input.cutContours) cutByPiece.set(cut.pieceId, cut)

  const cutting = buildCutting(input, cutByPiece)
  const glass = cutting.map((group) => toGlassItem(input, group))
  const isFoil = input.technique.kind === 'foil'

  return {
    technique: isFoil ? 'foil' : 'lead',
    cutting,
    glass,
    came: isFoil ? [] : buildCame(input),
    foil: isFoil ? buildFoil(input) : null,
    reinforcement: buildReinforcement(input),
    weight: input.weight,
    factors: input.factors,
    pieceCount: input.pieces.length,
  }
}

// --- Cutting list ------------------------------------------------------------

function buildCutting(input: BomInput, cutByPiece: Map<string, CutContour>): CutListGroup[] {
  // Group pieces by effective glass (null = unassigned), preserving first-appearance order.
  const order: (string | null)[] = []
  const byGlass = new Map<string | null, CutListRow[]>()

  for (const piece of input.pieces) {
    const key = pieceKey(piece)
    const glassId = input.glassByPiece[key] ?? null
    if (!byGlass.has(glassId)) {
      byGlass.set(glassId, [])
      order.push(glassId)
    }
    const label = input.labelByPiece[key] ?? ''
    byGlass.get(glassId)!.push(toRow(piece, key, label, cutByPiece.get(piece.id)))
  }

  const groups: CutListGroup[] = []
  for (const glassId of order) {
    const rows = byGlass.get(glassId)!.slice().sort(compareRows)
    const glass = glassId ? input.glasses[glassId] : undefined
    const netAreaMm2 = rows.reduce((sum, r) => sum + r.areaMm2, 0)
    groups.push({
      glassId,
      code: glassId ? (input.glassCodes[glassId] ?? UNASSIGNED_CODE) : UNASSIGNED_CODE,
      name: glass?.name ?? (glassId ? 'Unknown glass' : 'Unassigned'),
      color: glass?.color,
      manufacturer: glass?.manufacturer,
      rows,
      count: rows.length,
      netAreaMm2,
      buyAreaMm2: netAreaMm2 * (1 + input.factors.glassWaste),
      pieceIds: rows.map((r) => r.pieceId),
    })
  }
  // Stable ordering by code (assigned glasses ascending, the "?" bucket last).
  return groups.sort(compareGroups)
}

/** One cutting-list row from a piece + its cut contour (falling back to the piece if degenerate). */
function toRow(
  piece: Piece,
  contentId: string,
  label: string,
  cut: CutContour | undefined,
): CutListRow {
  const usable = cut && !cut.degenerate ? cut : undefined
  const bbox = usable ? usable.bbox : piece.bbox
  return {
    contentId,
    pieceId: piece.id,
    label,
    widthMm: bbox.max.x - bbox.min.x,
    heightMm: bbox.max.y - bbox.min.y,
    areaMm2: usable ? usable.area : piece.area,
    degenerate: cut ? cut.degenerate : false,
  }
}

function compareRows(a: CutListRow, b: CutListRow): number {
  const byLabel = naturalCompare(a.label, b.label)
  if (byLabel !== 0) return byLabel
  return b.areaMm2 - a.areaMm2
}

function compareGroups(a: CutListGroup, b: CutListGroup): number {
  if (a.code === UNASSIGNED_CODE) return b.code === UNASSIGNED_CODE ? 0 : 1
  if (b.code === UNASSIGNED_CODE) return -1
  return naturalCompare(a.code, b.code)
}

// --- Glass line items --------------------------------------------------------

function toGlassItem(input: BomInput, group: CutListGroup): GlassBomItem {
  const glass = group.glassId ? input.glasses[group.glassId] : undefined
  const sheet = glass ? suggestSheet(glass.sheetSizes, group.buyAreaMm2) : undefined
  const cost =
    glass && glass.pricePerM2 !== undefined
      ? (group.buyAreaMm2 / 1_000_000) * glass.pricePerM2
      : undefined
  return {
    glassId: group.glassId,
    code: group.code,
    name: group.name,
    color: group.color,
    manufacturer: group.manufacturer,
    count: group.count,
    netAreaMm2: group.netAreaMm2,
    buyAreaMm2: group.buyAreaMm2,
    sheet,
    cost,
    pieceIds: group.pieceIds,
  }
}

/** Suggest the largest available sheet and how many are needed to cover the buy area. */
function suggestSheet(
  sizes: BomInput['glasses'][string]['sheetSizes'],
  buyAreaMm2: number,
): SheetSuggestion | undefined {
  if (!sizes || sizes.length === 0) return undefined
  const largest = sizes.reduce((best, s) =>
    s.widthMm * s.heightMm > best.widthMm * best.heightMm ? s : best,
  )
  const sheetArea = largest.widthMm * largest.heightMm
  return {
    widthMm: largest.widthMm,
    heightMm: largest.heightMm,
    label: largest.label,
    sheetsNeeded: sheetArea > 0 ? Math.ceil(buyAreaMm2 / sheetArea) : 0,
  }
}

// --- Came (lead) -------------------------------------------------------------

function buildCame(input: BomInput): CameBomItem[] {
  const order: string[] = []
  const byProfile = new Map<
    string,
    { came: ReturnType<typeof resolveCame>; lengthMm: number; segmentIds: string[] }
  >()

  for (const segment of input.segments) {
    const came = resolveCame(input.technique, segment.id)
    const length = curveLength(segment.geometry)
    const entry = byProfile.get(came.profileId)
    if (entry) {
      entry.lengthMm += length
      entry.segmentIds.push(segment.id)
    } else {
      byProfile.set(came.profileId, { came, lengthMm: length, segmentIds: [segment.id] })
      order.push(came.profileId)
    }
  }

  return order.map((profileId) => {
    const { came, lengthMm, segmentIds } = byProfile.get(profileId)!
    return {
      profileId,
      name: came.name,
      kind: came.kind,
      flangeMm: came.flangeMm,
      heartMm: came.heartMm,
      netLengthMm: lengthMm,
      buyLengthMm: lengthMm * (1 + input.factors.leadWaste),
      segmentIds,
    }
  })
}

// --- Copper foil -------------------------------------------------------------

function buildFoil(input: BomInput): FoilBomItem {
  let netSeamLengthMm = 0
  const segmentIds: string[] = []
  for (const segment of input.segments) {
    netSeamLengthMm += curveLength(segment.geometry)
    segmentIds.push(segment.id)
  }
  const buySeamLengthMm = netSeamLengthMm * (1 + input.factors.leadWaste)
  const rollLengthMm = input.factors.foilRollLengthMm
  return {
    netSeamLengthMm,
    buySeamLengthMm,
    rollLengthMm,
    rollsNeeded: rollLengthMm > 0 ? Math.ceil(buySeamLengthMm / rollLengthMm) : 0,
    solderGramsPerMetre: input.factors.solderGramsPerMetre,
    solderGrams: (netSeamLengthMm / MM_PER_M) * input.factors.solderGramsPerMetre,
    segmentIds,
  }
}

// --- Reinforcement -----------------------------------------------------------

function buildReinforcement(input: BomInput): ReinforcementBomItem[] {
  const order: string[] = []
  const byMaterial = new Map<string, { count: number; totalLengthMm: number; barIds: string[] }>()
  for (const bar of input.reinforcements) {
    const length = Math.hypot(bar.b.x - bar.a.x, bar.b.y - bar.a.y)
    const entry = byMaterial.get(bar.material)
    if (entry) {
      entry.count += 1
      entry.totalLengthMm += length
      entry.barIds.push(bar.id)
    } else {
      byMaterial.set(bar.material, { count: 1, totalLengthMm: length, barIds: [bar.id] })
      order.push(bar.material)
    }
  }
  return order.map((material) => ({ material, ...byMaterial.get(material)! }))
}

// --- Helpers -----------------------------------------------------------------

/**
 * Natural-order compare so numbered labels/codes sort human-sensibly: `A2` before `A10`, `2` before
 * `10`. Splits each string into alternating text/number chunks and compares chunk by chunk. Empty
 * labels (unnumbered pieces) sort last.
 */
function naturalCompare(a: string, b: string): number {
  if (a === '' && b === '') return 0
  if (a === '') return 1
  if (b === '') return -1
  const ax = a.match(/(\d+|\D+)/g) ?? []
  const bx = b.match(/(\d+|\D+)/g) ?? []
  const n = Math.min(ax.length, bx.length)
  for (let i = 0; i < n; i++) {
    const ac = ax[i]!
    const bc = bx[i]!
    const an = /^\d/.test(ac)
    const bn = /^\d/.test(bc)
    if (an && bn) {
      const diff = Number(ac) - Number(bc)
      if (diff !== 0) return diff
    } else if (ac !== bc) {
      return ac < bc ? -1 : 1
    }
  }
  return ax.length - bx.length
}
