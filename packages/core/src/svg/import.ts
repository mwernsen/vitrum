import { detectPieces } from '../pieces/detect'
import type { PieceSegment } from '../pieces/types'
import type { DrawRole, SegmentDraft } from '../tools/types'

import { healNetwork, type HealResult, type HealSegment } from './heal'
import { parseSvg, scaleGeometries, type ParsedSvg } from './parse'
import { resolveUnits, type UnitResolution } from './units'

/**
 * The SVG import pipeline entry points (F-050), composing the pure stages into what the UI needs:
 * parse once, then re-scale and re-heal cheaply as the scale dialog and tolerance slider change.
 * Everything here is pure and DOM-free so it runs in Node and the round-trip test (F-043 ↔ F-050)
 * can drive it directly.
 */

/** The parse result plus the resolved unit mapping — cached by the UI across slider drags. */
export interface SvgSource {
  readonly parsed: ParsedSvg
  readonly unit: UnitResolution
}

/** Parse an SVG string and resolve its unit mapping in one step. */
export function readSvg(text: string): SvgSource {
  const parsed = parseSvg(text)
  return { parsed, unit: resolveUnits(parsed.size) }
}

export interface ImportOptions {
  /** Physical size of one SVG user unit in mm (from the unit resolution or the scale dialog). */
  readonly userUnitMm: number
  /** Healing tolerance in mm (0 = no healing beyond exact-coincidence merges). */
  readonly toleranceMm: number
  /** The role imported strokes take (lead lines by default). */
  readonly role: DrawRole
}

/** A previewable import: the healed network (with per-segment ids for highlighting), plus a summary. */
export interface ImportPreview {
  /** Healed segments in world mm, ready to become drawing drafts. */
  readonly segments: readonly HealSegment[]
  readonly heal: HealResult
  /** Pieces F-020 would detect from the healed network — drives the live piece count. */
  readonly pieceCount: number
  /** Unsupported content kinds dropped during parse (FR-5). */
  readonly dropped: readonly string[]
}

/** Scale the parsed geometry to mm, heal it, and count the pieces it yields (the live preview). */
export function buildImportPreview(source: SvgSource, options: ImportOptions): ImportPreview {
  const scaled = scaleGeometries(source.parsed.geometries, options.userUnitMm)
  const raw: HealSegment[] = scaled.map((geometry, i) => ({
    id: `svg-${i}`,
    geometry,
    role: options.role,
  }))
  const heal = healNetwork(raw, options.toleranceMm)
  return {
    segments: heal.segments,
    heal,
    pieceCount: countPieces(heal.segments),
    dropped: source.parsed.dropped,
  }
}

/** The drawing drafts (geometry + role) a preview's healed segments become when merged (F-011). */
export function toDrafts(segments: readonly HealSegment[]): SegmentDraft[] {
  return segments.map((s) => ({ geometry: s.geometry, role: s.role }))
}

/** Count the pieces F-020 detects from a healed network (used for the live preview count). */
export function countPieces(segments: readonly HealSegment[]): number {
  const pieceSegments: PieceSegment[] = segments.map((s, i) => ({
    id: s.id,
    geometry: s.geometry,
    role: s.role,
    endpoints: [`${i}a`, `${i}b`],
  }))
  return detectPieces(pieceSegments).pieces.length
}
