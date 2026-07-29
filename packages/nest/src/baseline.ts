import { bboxOfPoints, rotate, signedArea, type Vec2 } from '@vitrum/geometry'

import { rotationsFor } from './rotation'
import type { NestGlassInput, NestInput, NestPart } from './types'

/**
 * The naive baseline F-057's real nester must beat (FR-2): reduce each piece to its axis-aligned
 * bounding box (at whichever allowed rotation gives the smallest box), then shelf-pack those boxes
 * (first-fit-decreasing by height) onto sheets. It never interlocks concave pieces, so on any set with
 * concavities the raster nester needs fewer sheets / higher utilisation — which is exactly what the
 * FR-2 test asserts. Deterministic; used only as a comparison yardstick, never shipped as output.
 */
export interface BaselineResult {
  readonly sheetsByGlass: Readonly<Record<string, number>>
  readonly totalSheets: number
  /** Placed true piece area / total sheet area, in [0,1]. */
  readonly utilization: number
}

interface Box {
  readonly w: number
  readonly h: number
  readonly area: number
}

function partArea(ring: readonly Vec2[], holes: readonly (readonly Vec2[])[]): number {
  let a = Math.abs(signedArea(ring))
  for (const h of holes) a -= Math.abs(signedArea(h))
  return Math.max(0, a)
}

/** Smallest-area bounding box over the allowed rotations. */
function bestBox(part: NestPart, angles: readonly number[]): Box {
  let best: Box | null = null
  for (const deg of angles) {
    const rad = (deg * Math.PI) / 180
    const ring = rad === 0 ? part.ring : part.ring.map((p) => rotate(p, rad))
    const bb = bboxOfPoints(ring)
    const w = bb.max.x - bb.min.x
    const h = bb.max.y - bb.min.y
    const area = w * h
    if (!best || area < best.area) best = { w, h, area }
  }
  return best!
}

function shelfPack(boxes: Box[], sheetW: number, sheetH: number, spacing: number): number {
  // First-fit-decreasing by height into horizontal shelves.
  const sorted = boxes.slice().sort((a, b) => b.h - a.h)
  let sheets = 1
  let shelfY = 0
  let shelfH = 0
  let cursorX = 0
  const fits = (b: Box): boolean => b.w + spacing <= sheetW && b.h + spacing <= sheetH
  for (const b of sorted) {
    if (!fits(b)) continue // unplaceable — ignore (parity with the nester's "unplaced")
    const bw = b.w + spacing
    const bh = b.h + spacing
    if (cursorX + bw <= sheetW && shelfY + Math.max(shelfH, bh) <= sheetH) {
      // same shelf
      cursorX += bw
      shelfH = Math.max(shelfH, bh)
      continue
    }
    // new shelf
    if (shelfY + shelfH + bh <= sheetH) {
      shelfY += shelfH
      shelfH = bh
      cursorX = bw
      continue
    }
    // new sheet
    sheets++
    shelfY = 0
    shelfH = bh
    cursorX = bw
  }
  return sheets
}

function baselineGlass(parts: readonly NestPart[], glass: NestGlassInput, spacing: number): number {
  if (parts.length === 0) return 0
  const angles = rotationsFor(glass.rotation)
  const boxes = parts.map((p) => bestBox(p, angles))
  return shelfPack(boxes, glass.sheet.widthMm, glass.sheet.heightMm, spacing)
}

/** Run the bounding-box shelf baseline over the same problem the nester solves. */
export function bboxBaseline(input: NestInput): BaselineResult {
  const byGlass = new Map<string, NestPart[]>()
  for (const part of input.parts) {
    const list = byGlass.get(part.glassId)
    if (list) list.push(part)
    else byGlass.set(part.glassId, [part])
  }
  const sheetsByGlass: Record<string, number> = {}
  let totalSheets = 0
  let placedArea = 0
  let capacity = 0
  for (const glass of input.glasses) {
    const parts = byGlass.get(glass.glassId) ?? []
    const sheets = baselineGlass(parts, glass, input.spacingMm)
    sheetsByGlass[glass.glassId] = sheets
    totalSheets += sheets
    capacity += sheets * glass.sheet.widthMm * glass.sheet.heightMm
    for (const p of parts) placedArea += partArea(p.ring, p.holes)
  }
  return {
    sheetsByGlass,
    totalSheets,
    utilization: capacity > 0 ? placedArea / capacity : 0,
  }
}
