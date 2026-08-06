import { bboxOfPoints, rotate, signedArea, type Vec2 } from '@vitrum/geometry'

import { collides, dilate, makeSheet, rasterizeRings, stamp, type Mask } from './raster'
import { makeRng } from './rng'
import { rotationsFor } from './rotation'
import type {
  GlassNestResult,
  NestGlassInput,
  NestInput,
  NestPart,
  NestProgress,
  NestResult,
  NestSheet,
  NestStrategy,
  PlacedPart,
} from './types'

const DEFAULT_MAX_CELLS = 200_000
const DEG = Math.PI / 180

/** Area of a ring minus its holes (mm²); rotation/translation invariant. */
function partArea(ring: readonly Vec2[], holes: readonly (readonly Vec2[])[]): number {
  let a = Math.abs(signedArea(ring))
  for (const h of holes) a -= Math.abs(signedArea(h))
  return Math.max(0, a)
}

/** Pick a raster resolution (mm/cell): fine enough to nest tightly, coarse enough to stay fast. */
function resolveRes(
  widthMm: number,
  heightMm: number,
  spacingMm: number,
  maxCells: number,
): number {
  let res = Math.sqrt((widthMm * heightMm) / Math.max(1, maxCells))
  res = Math.max(0.5, Math.min(res, 4))
  // Never coarser than half the cut allowance, so the spacing gap can be represented.
  if (spacingMm > 0) res = Math.min(res, Math.max(0.5, spacingMm / 2))
  return res
}

/** One rotated, rasterised candidate placement footprint for a part. */
interface Candidate {
  readonly rotationDeg: number
  readonly ring: readonly Vec2[]
  readonly holes: readonly (readonly Vec2[])[]
  readonly mask: Mask
  /** mm coordinate of the dilated mask's cell (0,0) corner, in the rotated frame. */
  readonly originX: number
  readonly originY: number
}

function rotateRing(ring: readonly Vec2[], rad: number): Vec2[] {
  return rad === 0 ? ring.slice() : ring.map((p) => rotate(p, rad))
}

/** Build every allowed rotated footprint for one part at the chosen resolution + cut-allowance. */
function buildCandidates(
  part: NestPart,
  angles: readonly number[],
  res: number,
  dHalf: number,
): Candidate[] {
  const out: Candidate[] = []
  for (const deg of angles) {
    const rad = deg * DEG
    const ring = rotateRing(part.ring, rad)
    const holes = part.holes.map((h) => rotateRing(h, rad))
    const bb = bboxOfPoints(ring)
    const cols = Math.max(1, Math.ceil((bb.max.x - bb.min.x) / res) + 1)
    const rows = Math.max(1, Math.ceil((bb.max.y - bb.min.y) / res) + 1)
    const tight = rasterizeRings([ring, ...holes], res, bb.min.x, bb.min.y, cols, rows)
    const mask = dilate(tight, dHalf)
    out.push({
      rotationDeg: deg,
      ring,
      holes,
      mask,
      originX: bb.min.x - dHalf * res,
      originY: bb.min.y - dHalf * res,
    })
  }
  return out
}

/** Bottom-left scan: the lowest (then left-most) fitting cell for `mask` on `sheet`, or null. */
function bottomLeft(sheet: Mask, mask: Mask): { ox: number; oy: number } | null {
  const maxOx = sheet.cols - mask.cols
  const maxOy = sheet.rows - mask.rows
  if (maxOx < 0 || maxOy < 0) return null
  for (let oy = 0; oy <= maxOy; oy++) {
    for (let ox = 0; ox <= maxOx; ox++) {
      if (!collides(sheet, mask, ox, oy)) return { ox, oy }
    }
  }
  return null
}

interface OpenSheet {
  readonly occ: Mask
  readonly placed: PlacedPart[]
  placedArea: number
}

interface Placement {
  readonly ox: number
  readonly oy: number
  readonly cand: Candidate
}

/** Best (lowest) placement for a part on one sheet, across all its rotations; null if none fit. */
function placeOnSheet(occ: Mask, cands: readonly Candidate[]): Placement | null {
  let best: Placement | null = null
  for (const cand of cands) {
    const spot = bottomLeft(occ, cand.mask)
    if (!spot) continue
    if (!best || spot.oy < best.oy || (spot.oy === best.oy && spot.ox < best.ox)) {
      best = { ox: spot.ox, oy: spot.oy, cand }
    }
  }
  return best
}

function toPlaced(part: NestPart, area: number, p: Placement, res: number): PlacedPart {
  const offX = p.ox * res - p.cand.originX
  const offY = p.oy * res - p.cand.originY
  const shift = (pt: Vec2): Vec2 => ({ x: pt.x + offX, y: pt.y + offY })
  return {
    id: part.id,
    label: part.label,
    rotationDeg: p.cand.rotationDeg,
    offset: { x: offX, y: offY },
    ring: p.cand.ring.map(shift),
    holes: p.cand.holes.map((h) => h.map(shift)),
    area,
  }
}

/** One full placement pass for a glass, in a given part order. Deterministic. */
function packOnce(
  ordered: readonly NestPart[],
  areaById: Map<string, number>,
  candsById: Map<string, Candidate[]>,
  sheetCols: number,
  sheetRows: number,
  res: number,
): { sheets: OpenSheet[]; unplaced: string[] } {
  const sheets: OpenSheet[] = []
  const unplaced: string[] = []
  for (const part of ordered) {
    const cands = candsById.get(part.id)!
    const area = areaById.get(part.id)!
    let done = false
    for (const sheet of sheets) {
      const p = placeOnSheet(sheet.occ, cands)
      if (p) {
        stamp(sheet.occ, p.cand.mask, p.ox, p.oy)
        sheet.placed.push(toPlaced(part, area, p, res))
        sheet.placedArea += area
        done = true
        break
      }
    }
    if (done) continue
    // Open a fresh sheet.
    const occ = makeSheet(sheetCols, sheetRows)
    const p = placeOnSheet(occ, cands)
    if (!p) {
      unplaced.push(part.id) // larger than the sheet even rotated
      continue
    }
    stamp(occ, p.cand.mask, p.ox, p.oy)
    sheets.push({ occ, placed: [toPlaced(part, area, p, res)], placedArea: area })
  }
  return { sheets, unplaced }
}

/**
 * The sort key a strategy orders by, descending. `fewest` keys on area (the long-standing
 * behaviour); `tight` on the part's bbox height, so similar-height pieces band into shelves;
 * `fast` on its width, so pieces line up in rows. The key is a length for the two bbox
 * strategies and an area for `fewest` — they are never compared with each other.
 */
function orderKey(part: NestPart, area: number, strategy: NestStrategy): number {
  if (strategy === 'fewest') return area
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of part.ring) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const w = maxX - minX
  const h = maxY - minY
  // Secondary extent breaks ties within a band, scaled down so it never outranks the primary one.
  return strategy === 'tight' ? h + w / 1e6 : w + h / 1e6
}

/** Order parts by the strategy's key, optionally jittering it (seeded) to explore alternatives. */
function orderParts(
  parts: readonly NestPart[],
  areaById: Map<string, number>,
  rng: (() => number) | null,
  strategy: NestStrategy,
): NestPart[] {
  const keyed = parts.map((p) => {
    const jitter = rng ? 0.85 + 0.3 * rng() : 1
    return { p, k: orderKey(p, areaById.get(p.id)!, strategy) * jitter }
  })
  // Stable tie-break by id so equal-key parts have a deterministic order.
  keyed.sort((x, y) => y.k - x.k || (x.p.id < y.p.id ? -1 : x.p.id > y.p.id ? 1 : 0))
  return keyed.map((e) => e.p)
}

function nestGlass(
  parts: readonly NestPart[],
  glass: NestGlassInput,
  spacingMm: number,
  maxCells: number,
  seed: number,
  glassIndex: number,
  strategy: NestStrategy,
): GlassNestResult {
  const { widthMm, heightMm, label } = glass.sheet
  const res = resolveRes(widthMm, heightMm, spacingMm, maxCells)
  const dHalf = spacingMm <= 0 ? 0 : Math.max(1, Math.round(spacingMm / 2 / res))
  const sheetCols = Math.max(1, Math.floor(widthMm / res))
  const sheetRows = Math.max(1, Math.floor(heightMm / res))
  const sheetArea = widthMm * heightMm

  const angles = rotationsFor(glass.rotation)
  const areaById = new Map<string, number>()
  const candsById = new Map<string, Candidate[]>()
  for (const part of parts) {
    areaById.set(part.id, partArea(part.ring, part.holes))
    candsById.set(part.id, buildCandidates(part, angles, res, dHalf))
  }

  // A few seeded restarts; keep the layout with the fewest sheets (then best last-sheet fill).
  const restarts = Math.max(1, Math.min(6, Math.floor(400 / Math.max(1, parts.length))))
  const rng = makeRng((seed >>> 0) + glassIndex * 0x9e3779b1)
  let best: { sheets: OpenSheet[]; unplaced: string[] } | null = null
  const score = (r: { sheets: OpenSheet[]; unplaced: string[] }): [number, number, number] => {
    const last = r.sheets[r.sheets.length - 1]
    return [r.unplaced.length, r.sheets.length, last ? -last.placedArea : 0]
  }
  for (let i = 0; i < restarts; i++) {
    const ordered = orderParts(parts, areaById, i === 0 ? null : rng, strategy)
    const result = packOnce(ordered, areaById, candsById, sheetCols, sheetRows, res)
    if (!best) {
      best = result
    } else {
      const a = score(result)
      const b = score(best)
      if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) {
        best = result
      }
    }
  }
  const chosen = best!

  let totalPlaced = 0
  const sheets: NestSheet[] = chosen.sheets.map((s, index) => {
    totalPlaced += s.placedArea
    return {
      glassId: glass.glassId,
      index,
      widthMm,
      heightMm,
      label,
      parts: s.placed,
      utilization: sheetArea > 0 ? s.placedArea / sheetArea : 0,
    }
  })
  return {
    glassId: glass.glassId,
    sheets,
    sheetCount: sheets.length,
    unplaced: chosen.unplaced,
    utilization: sheets.length > 0 && sheetArea > 0 ? totalPlaced / (sheets.length * sheetArea) : 0,
  }
}

/**
 * Nest every glass's pieces onto its chosen sheet, deterministically from `input.seed` (F-057 FR-3).
 * Pieces are grouped by glass; each group is packed independently with the raster bottom-left nester,
 * honouring the per-glass rotation policy (grain, FR-1) and the cut allowance (FR-1). `onProgress` is
 * a pure side-channel for the worker's progress bar — it never affects the result.
 */
export function nestSheets(input: NestInput, onProgress?: (p: NestProgress) => void): NestResult {
  const maxCells = input.maxCellsPerSheet ?? DEFAULT_MAX_CELLS
  const strategy = input.strategy ?? 'fewest'
  const byGlass = new Map<string, NestPart[]>()
  for (const part of input.parts) {
    const list = byGlass.get(part.glassId)
    if (list) list.push(part)
    else byGlass.set(part.glassId, [part])
  }

  const glasses: GlassNestResult[] = []
  let sheetsSoFar = 0
  const total = input.glasses.length
  input.glasses.forEach((glass, i) => {
    onProgress?.({ fraction: total ? i / total : 0, glassId: glass.glassId, sheets: sheetsSoFar })
    const parts = byGlass.get(glass.glassId) ?? []
    const result =
      parts.length === 0
        ? { glassId: glass.glassId, sheets: [], sheetCount: 0, unplaced: [], utilization: 0 }
        : nestGlass(parts, glass, input.spacingMm, maxCells, input.seed, i, strategy)
    glasses.push(result)
    sheetsSoFar += result.sheetCount
  })
  onProgress?.({ fraction: 1, glassId: null, sheets: sheetsSoFar })

  return { seed: input.seed, glasses, totalSheets: sheetsSoFar }
}
