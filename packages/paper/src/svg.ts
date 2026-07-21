import {
  arcEnd,
  arcPointAt,
  arcStart,
  arcSweep,
  bboxOfPoints,
  vec2,
  type Arc,
  type BBox,
  type CubicBezier,
  type Line,
  type Vec2,
} from '@vitrum/geometry'

import type { ExportPiece, ExportScene, ExportSegment, SvgOptions } from './exportScene'
import { fmt } from './format'

/**
 * SVG export (F-043). Three flavours share one physical-unit document: the `<svg>` carries
 * `width`/`height` in **mm** and a `viewBox` in the same millimetre space, so 1 mm in the file is
 * 1 mm on Inkscape's / Illustrator's rulers (FR-1). Output is deterministic text (fixed formatting,
 * stable ordering) so the same document yields byte-identical bytes (FR-4).
 *
 * - `linework` keeps the true segment geometry as SVG path commands (`L`/`C`/`A`), the lossless
 *   round-trip target for SVG import (F-050 — see `svgRoundTrip.test.ts`).
 * - `cut` emits one closed path per piece from its technique cut contour (F-021), numbered via
 *   `id` + `<title>` conventions both Cricut Design Space and Silhouette Studio accept (FR-2).
 * - `render` fills pieces with glass colour under the lead strokes for web/portfolio use.
 *
 * Colours are physical output values, not design tokens (rendered document content is token-exempt,
 * like the canvas' glass fills), kept as named constants.
 */
const INK = '#111111'
const CUT_STROKE_MM = 0.3
const LEAD_MIN_MM = 0.4
const BORDER_MM = 0.9
const TWO_PI = Math.PI * 2
/** Gap (mm) between pieces when the cut template is spread on a grid. */
const GRID_GAP_MM = 6

export function buildSvg(scene: ExportScene, options: SvgOptions): string {
  switch (options.flavor) {
    case 'linework':
      return lineworkSvg(scene, options)
    case 'cut':
      return options.cutLayout === 'grid'
        ? cutGridSvg(scene, options)
        : cutInPlaceSvg(scene, options)
    case 'render':
      return renderSvg(scene, options)
  }
}

// --- Linework (round-trip target for F-050) ---------------------------------

function lineworkSvg(scene: ExportScene, options: SvgOptions): string {
  const byRole: Record<'lead' | 'border', ExportSegment[]> = { lead: [], border: [] }
  for (const seg of orderedSegments(scene)) {
    // Construction guides are not part of the physical design and are never exported.
    if (seg.role === 'construction') continue
    byRole[seg.role].push(seg)
  }
  const groups: string[] = []
  for (const role of ['lead', 'border'] as const) {
    const segs = byRole[role]
    if (segs.length === 0) continue
    const width = role === 'border' ? BORDER_MM : LEAD_MIN_MM
    const paths = segs
      .map(
        (seg) => `    <path class="${role}" data-role="${role}" d="${segmentPath(seg.geometry)}"/>`,
      )
      .join('\n')
    groups.push(
      `  <g id="${role}-lines" fill="none" stroke="${INK}" stroke-width="${fmt(width)}" stroke-linecap="round" stroke-linejoin="round">\n${paths}\n  </g>`,
    )
  }
  return svgDocument(scene.contentBounds, options.projectName, groups.join('\n'))
}

// --- Cut templates (the cutter use case) ------------------------------------

function cutInPlaceSvg(scene: ExportScene, options: SvgOptions): string {
  const parts: string[] = []
  for (const piece of orderedPieces(scene)) {
    parts.push(cutPiecePath(piece, (p) => p))
    if (options.includeNumbers) parts.push(pieceNumber(piece, (p) => p))
  }
  const body = `  <g id="cut" fill="none" stroke="${INK}" stroke-width="${fmt(CUT_STROKE_MM)}">\n${parts.join('\n')}\n  </g>`
  return svgDocument(scene.contentBounds, options.projectName, body)
}

/**
 * Spread every piece's cut contour onto a numbered grid (Diafane parity). Not a true nesting (that is
 * F-057) — a simple row-major placement so tiny contours are separable on the cutter.
 */
function cutGridSvg(scene: ExportScene, options: SvgOptions): string {
  const pieces = orderedPieces(scene)
  const cells = pieces.map((piece) => {
    const ring = piece.cutRing && piece.cutRing.length >= 3 ? piece.cutRing : piece.ring
    return { piece, box: bboxOfPoints(ring) }
  })
  const cellW = Math.max(1, ...cells.map((c) => c.box.max.x - c.box.min.x)) + GRID_GAP_MM
  const cellH = Math.max(1, ...cells.map((c) => c.box.max.y - c.box.min.y)) + GRID_GAP_MM
  const cols = Math.max(1, Math.ceil(Math.sqrt(cells.length)))
  const rows = Math.max(1, Math.ceil(cells.length / cols))

  const parts: string[] = []
  cells.forEach(({ piece, box }, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    // Translate the piece so its bbox top-left sits at the cell's top-left (plus half the gap).
    const dx = col * cellW + GRID_GAP_MM / 2 - box.min.x
    const dy = row * cellH + GRID_GAP_MM / 2 - box.min.y
    const move = (p: Vec2): Vec2 => vec2(p.x + dx, p.y + dy)
    parts.push(cutPiecePath(piece, move))
    if (options.includeNumbers) parts.push(pieceNumber(piece, move))
  })

  const bounds: BBox = { min: vec2(0, 0), max: vec2(cols * cellW, rows * cellH) }
  const body = `  <g id="cut" fill="none" stroke="${INK}" stroke-width="${fmt(CUT_STROKE_MM)}">\n${parts.join('\n')}\n  </g>`
  return svgDocument(bounds, options.projectName, body)
}

/** One piece as a single closed path (outer ring + holes as subpaths), id + title numbered (FR-2). */
function cutPiecePath(piece: ExportPiece, move: (p: Vec2) => Vec2): string {
  const outer = piece.cutRing && piece.cutRing.length >= 3 ? piece.cutRing : piece.ring
  const holes =
    piece.cutRing && piece.cutRing.length >= 3 ? (piece.cutHoleRings ?? []) : piece.holeRings
  let d = ringPath(outer.map(move))
  for (const hole of holes) if (hole.length >= 3) d += ' ' + ringPath(hole.map(move))
  const label = piece.label ?? ''
  const idAttr = label ? ` id="piece-${slug(label)}"` : ''
  const title = label ? `<title>${esc(label)}</title>` : ''
  return `    <path${idAttr} d="${d}">${title}</path>`
}

// --- Coloured render --------------------------------------------------------

function renderSvg(scene: ExportScene, options: SvgOptions): string {
  const fills: string[] = []
  for (const piece of orderedPieces(scene)) {
    if (!piece.fillColor || piece.ring.length < 3) continue
    let d = ringPath(piece.ring)
    for (const hole of piece.holeRings) if (hole.length >= 3) d += ' ' + ringPath(hole)
    fills.push(`    <path d="${d}" fill="${piece.fillColor}" fill-rule="evenodd"/>`)
  }
  const strokes: string[] = []
  for (const seg of orderedSegments(scene)) {
    if (seg.role === 'construction') continue
    const width = seg.role === 'border' ? BORDER_MM : Math.max(LEAD_MIN_MM, seg.widthMm)
    strokes.push(`    <path d="${segmentPath(seg.geometry)}" stroke-width="${fmt(width)}"/>`)
  }
  const numbers = options.includeNumbers
    ? orderedPieces(scene)
        .map((piece) => pieceNumber(piece, (p) => p))
        .filter((s) => s.length > 0)
    : []

  const body =
    `  <g id="glass">\n${fills.join('\n')}\n  </g>\n` +
    `  <g id="lead" fill="none" stroke="${INK}" stroke-linecap="round" stroke-linejoin="round">\n${strokes.join('\n')}\n  </g>` +
    (numbers.length > 0
      ? `\n  <g id="numbers" fill="${INK}" font-family="monospace" text-anchor="middle">\n${numbers.join('\n')}\n  </g>`
      : '')
  return svgDocument(scene.contentBounds, options.projectName, body)
}

// --- Shared helpers ---------------------------------------------------------

/** Segments sorted by id so the same document always serialises in the same order (FR-4). */
function orderedSegments(scene: ExportScene): ExportSegment[] {
  return [...scene.segments].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Pieces sorted by their stable content-id key (FR-4). */
function orderedPieces(scene: ExportScene): ExportPiece[] {
  return [...scene.pieces].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

function pieceNumber(piece: ExportPiece, move: (p: Vec2) => Vec2): string {
  if (!piece.label || !piece.labelAt) return ''
  const at = move(piece.labelAt)
  return `    <text x="${fmt(at.x)}" y="${fmt(at.y)}" font-family="monospace" text-anchor="middle" dominant-baseline="middle" font-size="4" fill="${INK}">${esc(piece.label)}</text>`
}

/** An SVG path `d` for one segment's true geometry (line / cubic / circular arc). */
function segmentPath(geometry: Line | Arc | CubicBezier): string {
  switch (geometry.kind) {
    case 'line':
      return `M ${pt(geometry.a)} L ${pt(geometry.b)}`
    case 'cubic':
      return `M ${pt(geometry.p0)} C ${pt(geometry.p1)} ${pt(geometry.p2)} ${pt(geometry.p3)}`
    case 'arc':
      return arcPath(geometry)
  }
}

/**
 * A circular arc as SVG `A` commands. SVG maps 1:1 onto our y-down world space, so our `ccw`
 * (angle-increasing) is exactly SVG's `sweep-flag = 1`. A full circle can't be a single `A`
 * (start ≡ end), so it is split at its midpoint into two arcs.
 */
function arcPath(a: Arc): string {
  const r = fmt(a.radius)
  const sweep = arcSweep(a)
  const sf = a.ccw ? 1 : 0
  const start = arcStart(a)
  if (sweep >= TWO_PI - 1e-9) {
    const mid = arcPointAt(a, 0.5)
    const end = arcEnd(a)
    return `M ${pt(start)} A ${r} ${r} 0 0 ${sf} ${pt(mid)} A ${r} ${r} 0 0 ${sf} ${pt(end)}`
  }
  const large = sweep > Math.PI ? 1 : 0
  return `M ${pt(start)} A ${r} ${r} 0 ${large} ${sf} ${pt(arcEnd(a))}`
}

/** A closed ring as an SVG subpath (`M … L … Z`). */
function ringPath(ring: readonly Vec2[]): string {
  if (ring.length === 0) return ''
  const [first, ...rest] = ring
  return `M ${pt(first!)} ` + rest.map((p) => `L ${pt(p)}`).join(' ') + ' Z'
}

function pt(v: Vec2): string {
  return `${fmt(v.x)} ${fmt(v.y)}`
}

/** Wrap a body in an `<svg>` with physical mm dimensions and a matching mm viewBox (FR-1). */
function svgDocument(bounds: BBox, projectName: string, body: string): string {
  const w = Math.max(0, bounds.max.x - bounds.min.x)
  const h = Math.max(0, bounds.max.y - bounds.min.y)
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(w)}mm" height="${fmt(h)}mm" ` +
    `viewBox="${fmt(bounds.min.x)} ${fmt(bounds.min.y)} ${fmt(w)} ${fmt(h)}">\n` +
    `  <title>${esc(projectName)}</title>\n` +
    `${body}\n` +
    `</svg>\n`
  )
}

/** XML-escape text content / attribute values. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A filesystem/id-safe slug from a label (`A1`, `?3` → `piece-A1`, `piece-3`). */
function slug(label: string): string {
  return label.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'x'
}
