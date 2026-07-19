import type {
  CutContour,
  Diagnostic,
  LengthUnit,
  Piece,
  PreviewShape,
  SnapHit,
  SnapKind,
  SolderFinish,
  Viewport,
  ViewSize,
} from '@vitrum/core'
import {
  formatFractionalInch,
  gridStep,
  pieceKey,
  rulerStepMm,
  ticksInRange,
  visibleWorldBounds,
  worldToScreen,
} from '@vitrum/core'
import type { BBox, Vec2 } from '@vitrum/geometry'
import { bboxExpand, bboxOf, bboxOverlap, vec2 } from '@vitrum/geometry'
import type { Glass, GlassId, PieceId, Segment, TransparencyClass } from '@vitrum/model'

import { segmentToWorldPoints } from './scene'

/**
 * Colours the canvas chrome (grid, rulers, crosshair) draws with, resolved from the
 * design-token ramp at runtime so the 2D canvas honours the same palette as the DOM
 * (F-003 Design: ink/paper ramp). Only leaf tokens (literal colours) are read — semantic
 * aliases resolve to `var(...)` in `getComputedStyle` and would not be usable here.
 * Rendered document content is data-driven and token-exempt, but we still draw it from
 * the ramp for now since no glass colours exist yet.
 */
export interface CanvasPalette {
  readonly gridMinor: string
  readonly gridMajor: string
  readonly axis: string
  readonly cursor: string
  readonly content: string
  readonly construction: string
  readonly snap: string
  readonly selection: string
  readonly handle: string
  readonly rulerBg: string
  readonly rulerBorder: string
  readonly rulerTick: string
  readonly rulerText: string
  /** Cycling fills for the F-020 dev piece overlay, drawn from the vitrail palette. */
  readonly pieceFills: readonly string[]
  readonly danger: string
  /** Semantic status token for unassigned-piece hatching and counts (F-023). */
  readonly warning: string
  /** Sunken base fill an unassigned piece sits on (F-023). */
  readonly unassignedBg: string
  /** Lead came line colour (F-021), and the three copper-foil solder-bead finishes. */
  readonly lead: string
  readonly solderSilver: string
  readonly solderCopper: string
  readonly solderBlack: string
  /** DRC violation marker colours by severity (F-030): error/warning/info. */
  readonly severityError: string
  readonly severityWarning: string
  readonly severityInfo: string
}

/**
 * How the technique model (F-021) styles the drawn network: lead lines render at true came flange
 * width (zoom-proportional), foil designs render as thin solder-coloured lines. `leadWidthMm`
 * resolves a segment's came flange (heavier perimeter came shows as a thicker line).
 */
export interface TechniqueRender {
  readonly kind: 'lead' | 'foil'
  readonly solderFinish: SolderFinish
  readonly leadWidthMm: (segmentId: string, role: string) => number
}

const FALLBACK: CanvasPalette = {
  gridMinor: '#e9e9e4',
  gridMajor: '#d9d9d2',
  axis: '#bcbcb4',
  cursor: '#2f63e8',
  content: '#1f1f1f',
  construction: '#6b6b68',
  snap: '#1d50cf',
  selection: '#2f63e8',
  handle: '#1d50cf',
  rulerBg: '#ffffff',
  rulerBorder: '#e9e9e4',
  rulerTick: '#d9d9d2',
  rulerText: '#6b6b68',
  pieceFills: ['#2f63e8', '#d97706', '#059669', '#e11d48', '#7c3aed'],
  danger: '#e11d48',
  warning: '#c4860d',
  unassignedBg: '#f0f0ea',
  lead: '#4a4a48',
  solderSilver: '#6b6b68',
  solderCopper: '#c4860d',
  solderBlack: '#121212',
  severityError: '#e11d48',
  severityWarning: '#d97706',
  severityInfo: '#1d50cf',
}

/** Read the canvas palette from an element's resolved custom properties. */
export function readCanvasPalette(el: HTMLElement): CanvasPalette {
  const cs = getComputedStyle(el)
  const read = (name: string, fallback: string): string =>
    cs.getPropertyValue(name).trim() || fallback
  return {
    gridMinor: read('--paper-200', FALLBACK.gridMinor),
    gridMajor: read('--paper-300', FALLBACK.gridMajor),
    axis: read('--paper-400', FALLBACK.axis),
    cursor: read('--cobalt-500', FALLBACK.cursor),
    content: read('--ink-800', FALLBACK.content),
    construction: read('--ink-500', FALLBACK.construction),
    snap: read('--cobalt-600', FALLBACK.snap),
    selection: read('--cobalt-500', FALLBACK.selection),
    handle: read('--cobalt-600', FALLBACK.handle),
    rulerBg: read('--paper-0', FALLBACK.rulerBg),
    rulerBorder: read('--paper-200', FALLBACK.rulerBorder),
    rulerTick: read('--paper-300', FALLBACK.rulerTick),
    rulerText: read('--ink-500', FALLBACK.rulerText),
    pieceFills: [
      read('--cobalt-500', FALLBACK.pieceFills[0]!),
      read('--amber-600', FALLBACK.pieceFills[1]!),
      read('--emerald-600', FALLBACK.pieceFills[2]!),
      read('--ruby-600', FALLBACK.pieceFills[3]!),
      read('--violet-600', FALLBACK.pieceFills[4]!),
    ],
    danger: read('--danger-600', FALLBACK.danger),
    warning: read('--warning-600', FALLBACK.warning),
    unassignedBg: read('--surface-sunken', FALLBACK.unassignedBg),
    lead: read('--ink-600', FALLBACK.lead),
    solderSilver: read('--ink-500', FALLBACK.solderSilver),
    solderCopper: read('--amber-600', FALLBACK.solderCopper),
    solderBlack: read('--ink-900', FALLBACK.solderBlack),
    // Leaf tokens (not the semantic aliases) so the values resolve to real colours on the canvas
    // (F-003), matching the Rules panel's severity dots.
    severityError: read('--ruby-600', FALLBACK.severityError),
    severityWarning: read('--amber-600', FALLBACK.severityWarning),
    severityInfo: read('--cobalt-600', FALLBACK.severityInfo),
  }
}

/** The solder-bead colour for a foil finish. */
function solderColor(palette: CanvasPalette, finish: SolderFinish): string {
  return finish === 'copper'
    ? palette.solderCopper
    : finish === 'black'
      ? palette.solderBlack
      : palette.solderSilver
}

/** Ruler thickness in CSS px (top ruler height / left ruler width). */
export const RULER_SIZE = 22

/**
 * Size a canvas's backing store for HiDPI and return a context whose transform maps CSS
 * pixels 1:1 (so all drawing code works in CSS px). Returns `null` where 2D canvas is
 * unavailable (e.g. jsdom in component tests), which every draw call tolerates.
 */
export function prepareContext(
  canvas: HTMLCanvasElement,
  size: ViewSize,
  dpr: number,
): CanvasRenderingContext2D | null {
  const backingW = Math.max(1, Math.round(size.width * dpr))
  const backingH = Math.max(1, Math.round(size.height * dpr))
  if (canvas.width !== backingW) canvas.width = backingW
  if (canvas.height !== backingH) canvas.height = backingH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size.width, size.height)
  return ctx
}

function crisp(v: number): number {
  return Math.round(v) + 0.5
}

/** Draw the adaptive grid and world axes. Redrawn only when the viewport changes. */
export function drawGrid(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  size: ViewSize,
  palette: CanvasPalette,
): void {
  if (!ctx) return
  const { minor, major } = gridStep(vp.scale)
  const world = visibleWorldBounds(vp, size)

  const verticals = (step: number, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const x of ticksInRange(world.min.x, world.max.x, step)) {
      const sx = crisp(worldToScreen(vp, vec2(x, 0)).x)
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, size.height)
    }
    for (const y of ticksInRange(world.min.y, world.max.y, step)) {
      const sy = crisp(worldToScreen(vp, vec2(0, y)).y)
      ctx.moveTo(0, sy)
      ctx.lineTo(size.width, sy)
    }
    ctx.stroke()
  }

  verticals(minor, palette.gridMinor)
  verticals(major, palette.gridMajor)

  // World axes (x = 0, y = 0), drawn a touch stronger so the origin is findable.
  ctx.strokeStyle = palette.axis
  ctx.lineWidth = 1
  ctx.beginPath()
  const origin = worldToScreen(vp, vec2(0, 0))
  if (origin.x >= 0 && origin.x <= size.width) {
    ctx.moveTo(crisp(origin.x), 0)
    ctx.lineTo(crisp(origin.x), size.height)
  }
  if (origin.y >= 0 && origin.y <= size.height) {
    ctx.moveTo(0, crisp(origin.y))
    ctx.lineTo(size.width, crisp(origin.y))
  }
  ctx.stroke()
}

/** Smallest on-screen line weight (CSS px) so a came stays visible when zoomed far out. */
const MIN_LEAD_PX = 1.25
/** On-screen weight (CSS px) of the thin copper-foil solder line. */
const FOIL_PX = 1.5

/**
 * Draw the document's lead-line network, culling segments outside the visible region so
 * cost tracks what's on screen, not the document size (FR-4). When a `technique` is supplied
 * (F-021), lead lines render at true came flange width (zoom-proportional, heavier perimeter
 * came reading as a thicker line) and foil designs render as thin solder-coloured lines.
 */
export function drawContent(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  size: ViewSize,
  segments: readonly Segment[],
  palette: CanvasPalette,
  technique?: TechniqueRender,
): void {
  if (!ctx) return
  const visible = bboxExpand(visibleWorldBounds(vp, size), 5)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  const foilStroke = technique ? solderColor(palette, technique.solderFinish) : palette.content

  for (const segment of segments) {
    const box: BBox = bboxOf(segment.geometry)
    if (!bboxOverlap(box, visible)) continue

    const construction = segment.role === 'construction'
    if (construction) {
      ctx.strokeStyle = palette.construction
      ctx.lineWidth = 1.25
      ctx.setLineDash([4, 4])
    } else if (!technique) {
      ctx.strokeStyle = palette.content
      ctx.lineWidth = segment.role === 'border' ? 2 : 1.25
      ctx.setLineDash([])
    } else if (technique.kind === 'foil') {
      // Copper foil: a thin solder-coloured line regardless of piece size or zoom.
      ctx.strokeStyle = foilStroke
      ctx.lineWidth = FOIL_PX
      ctx.setLineDash([])
    } else {
      // Lead came: draw at true flange width so heavier (perimeter) came reads as a thicker line.
      const widthPx = technique.leadWidthMm(segment.id, segment.role) * vp.scale
      ctx.strokeStyle = segment.role === 'border' ? palette.content : palette.lead
      ctx.lineWidth = Math.max(MIN_LEAD_PX, widthPx)
      ctx.setLineDash([])
    }

    const points = segmentToWorldPoints(segment.geometry)
    ctx.beginPath()
    points.forEach((p, i) => {
      const s = worldToScreen(vp, p)
      if (i === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    })
    ctx.stroke()
  }
  ctx.setLineDash([])
}

/**
 * Draw the technique-derived cut contours (F-021 dev overlay): the inset outline where each piece
 * of glass is actually cut, so toggling lead⇄foil or a per-segment came override visibly shifts the
 * cut lines. Degenerate contours (a piece too small to inset) are drawn in the danger colour.
 */
export function drawCutContours(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  contours: readonly CutContour[],
  palette: CanvasPalette,
): void {
  if (!ctx || contours.length === 0) return
  ctx.save()
  ctx.setLineDash([3, 3])
  ctx.lineWidth = 1
  for (const cut of contours) {
    if (cut.ring.length < 2) continue
    ctx.strokeStyle = cut.degenerate ? palette.danger : palette.snap
    ctx.beginPath()
    traceRing(ctx, vp, cut.ring)
    for (const hole of cut.holeRings) traceRing(ctx, vp, hole)
    ctx.stroke()
  }
  ctx.restore()
}

function traceRing(ctx: CanvasRenderingContext2D, vp: Viewport, ring: readonly Vec2[]): void {
  ring.forEach((p, i) => {
    const s = worldToScreen(vp, p)
    if (i === 0) ctx.moveTo(s.x, s.y)
    else ctx.lineTo(s.x, s.y)
  })
  ctx.closePath()
}

/**
 * Draw the detected-piece overlay (F-020 dev visualization): each piece filled with a
 * cycling vitrail colour (holes punched out via the even-odd rule) and labelled with its
 * stable id, so redrawing a line and watching ids stay put is eyeballable. Culled to the
 * visible region like `drawContent`. Rendered document content is token-exempt, but we still
 * source the fills from the vitrail palette so the overlay reads as glass, not chrome.
 */
export function drawPieceFills(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  size: ViewSize,
  pieces: readonly Piece[],
  palette: CanvasPalette,
): void {
  if (!ctx || pieces.length === 0) return
  const visible = bboxExpand(visibleWorldBounds(vp, size), 5)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '10px "Geist Mono", ui-monospace, monospace'

  pieces.forEach((piece, i) => {
    if (!bboxOverlap(piece.bbox, visible)) return
    const fill = palette.pieceFills[i % palette.pieceFills.length]!
    ctx.beginPath()
    traceRing(ctx, vp, piece.ring)
    for (const hole of piece.holeRings) traceRing(ctx, vp, hole)
    ctx.fillStyle = fill
    ctx.globalAlpha = 0.16
    ctx.fill('evenodd')
    ctx.globalAlpha = 1

    const c = worldToScreen(vp, piece.centroid)
    ctx.fillStyle = palette.rulerText
    ctx.fillText(piece.id, c.x, c.y)
  })
}

/** On-screen opacity per transparency class — the simple alpha/whiteness model of F-023 v1. */
const TRANSPARENCY_ALPHA: Record<TransparencyClass, number> = {
  transparent: 0.5,
  translucent: 0.68,
  opalescent: 0.85,
  opaque: 1,
}

/** Trace a piece (outer ring plus holes) as one even-odd path in screen space. */
function tracePiece(ctx: CanvasRenderingContext2D, vp: Viewport, piece: Piece): void {
  ctx.beginPath()
  traceRing(ctx, vp, piece.ring)
  for (const hole of piece.holeRings) traceRing(ctx, vp, hole)
}

/**
 * Hatch inside the current (already-traced) even-odd path: parallel 45° lines across the piece's
 * screen bbox, clipped to the piece. Used for glass texture and unassigned-piece marking. The path
 * must be current on entry; the clip is undone on return.
 */
function hatchInside(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  piece: Piece,
  color: string,
  alpha: number,
  spacingPx: number,
): void {
  const a = worldToScreen(vp, piece.bbox.min)
  const b = worldToScreen(vp, piece.bbox.max)
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const span = x1 - x0 + (y1 - y0)
  ctx.save()
  ctx.clip('evenodd')
  ctx.strokeStyle = color
  ctx.globalAlpha = alpha
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let d = 0; d <= span; d += spacingPx) {
    ctx.moveTo(x0 + d, y0)
    ctx.lineTo(x0 + d - (y1 - y0), y1)
  }
  ctx.stroke()
  ctx.restore()
  ctx.globalAlpha = 1
}

/**
 * Draw the coloured panel (F-023): fill each piece with its glass base colour, dimmed by the glass's
 * transparency class, with a light procedural hatch for textured glass; pieces with no glass get a
 * sunken base plus a warning-token hatch so they are visually unmistakable (FR-3). This is the "flat"
 * render — the lead/foil network (F-021) draws on top via {@link drawContent}. Culled to the visible
 * region so cost tracks what is on screen (FR-4).
 */
export function drawGlassFills(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  size: ViewSize,
  pieces: readonly Piece[],
  glassFor: (piece: Piece) => GlassId | undefined,
  glasses: Readonly<Record<GlassId, Glass>>,
  palette: CanvasPalette,
): void {
  if (!ctx || pieces.length === 0) return
  const visible = bboxExpand(visibleWorldBounds(vp, size), 5)
  for (const piece of pieces) {
    if (!bboxOverlap(piece.bbox, visible)) continue
    const glassId = glassFor(piece)
    const glass = glassId ? glasses[glassId] : undefined
    tracePiece(ctx, vp, piece)
    if (glass) {
      ctx.globalAlpha = TRANSPARENCY_ALPHA[glass.transparency]
      ctx.fillStyle = glass.color
      ctx.fill('evenodd')
      ctx.globalAlpha = 1
      if (glass.texture !== 'smooth') hatchInside(ctx, vp, piece, palette.content, 0.08, 6)
    } else {
      ctx.fillStyle = palette.unassignedBg
      ctx.fill('evenodd')
      // Re-trace (fill left the path current, but be explicit before clipping/hatching).
      tracePiece(ctx, vp, piece)
      hatchInside(ctx, vp, piece, palette.warning, 0.4, 7)
    }
  }
}

/** Outline the pieces selected in piece-select mode (F-023). Drawn on the overlay layer. */
export function drawPieceSelection(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  pieces: readonly Piece[],
  selected: ReadonlySet<PieceId>,
  palette: CanvasPalette,
): void {
  if (!ctx || selected.size === 0) return
  ctx.save()
  ctx.strokeStyle = palette.selection
  ctx.lineWidth = 2
  ctx.setLineDash([])
  for (const piece of pieces) {
    if (!selected.has(pieceKey(piece))) continue
    tracePiece(ctx, vp, piece)
    ctx.stroke()
  }
  ctx.restore()
}

/** Highlight the piece under the cursor (F-020 hover). Drawn on the overlay layer. */
export function drawPieceHighlight(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  pieces: readonly Piece[],
  hoveredId: string | null,
  palette: CanvasPalette,
): void {
  if (!ctx || !hoveredId) return
  const piece = pieces.find((p) => p.id === hoveredId)
  if (!piece) return
  ctx.beginPath()
  traceRing(ctx, vp, piece.ring)
  for (const hole of piece.holeRings) traceRing(ctx, vp, hole)
  ctx.fillStyle = palette.selection
  ctx.globalAlpha = 0.22
  ctx.fill('evenodd')
  ctx.globalAlpha = 1
  ctx.strokeStyle = palette.selection
  ctx.lineWidth = 1.5
  ctx.stroke()
}

/** Draw diagnostic markers (F-020): free ends, near-misses and duplicate/overlap segments. */
export function drawDiagnostics(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  diagnostics: readonly Diagnostic[],
  palette: CanvasPalette,
): void {
  if (!ctx || diagnostics.length === 0) return
  ctx.save()
  ctx.strokeStyle = palette.danger
  ctx.fillStyle = palette.danger
  ctx.lineWidth = 1.5
  const g = 5
  for (const d of diagnostics) {
    const s = worldToScreen(vp, d.at)
    ctx.beginPath()
    if (d.kind === 'dangling-end') {
      ctx.arc(s.x, s.y, g, 0, Math.PI * 2)
      ctx.stroke()
    } else if (d.kind === 'near-miss') {
      ctx.moveTo(s.x - g, s.y - g)
      ctx.lineTo(s.x + g, s.y + g)
      ctx.moveTo(s.x + g, s.y - g)
      ctx.lineTo(s.x - g, s.y + g)
      ctx.stroke()
    } else {
      ctx.strokeRect(s.x - g, s.y - g, g * 2, g * 2)
    }
  }
  ctx.restore()
}

/** A canvas-drawable DRC violation marker: a located point with a severity. */
export interface ViolationMarker {
  readonly at: Vec2
  readonly severity: 'error' | 'warning' | 'info'
  readonly key: string
}

/**
 * Draw DRC violation markers (F-030): a severity-coloured dot at each violation's anchor, with a
 * ring around the currently-selected one so clicking a row and zooming-to reads as "this one". Drawn
 * on the overlay layer, above content.
 */
export function drawViolations(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  markers: readonly ViolationMarker[],
  selectedKey: string | null,
  palette: CanvasPalette,
): void {
  if (!ctx || markers.length === 0) return
  const colorFor = (severity: ViolationMarker['severity']): string =>
    severity === 'error'
      ? palette.severityError
      : severity === 'warning'
        ? palette.severityWarning
        : palette.severityInfo
  ctx.save()
  for (const m of markers) {
    const s = worldToScreen(vp, m.at)
    const color = colorFor(m.severity)
    if (m.key === selectedKey) {
      ctx.beginPath()
      ctx.arc(s.x, s.y, 9, 0, Math.PI * 2)
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(s.x, s.y, 4.5, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = palette.rulerBg
    ctx.stroke()
  }
  ctx.restore()
}

/** Draw the cursor crosshair. Its own layer so pointer moves never redraw content. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D | null,
  size: ViewSize,
  cursorScreen: Vec2 | null,
  palette: CanvasPalette,
): void {
  if (!ctx || !cursorScreen) return
  ctx.strokeStyle = palette.cursor
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.7
  ctx.beginPath()
  ctx.moveTo(crisp(cursorScreen.x), 0)
  ctx.lineTo(crisp(cursorScreen.x), size.height)
  ctx.moveTo(0, crisp(cursorScreen.y))
  ctx.lineTo(size.width, crisp(cursorScreen.y))
  ctx.stroke()
  ctx.globalAlpha = 1
}

/**
 * Draw a drawing tool's live preview (F-011): placed spans solid, the rubber-band span
 * to the cursor dashed, and anchor handles as small squares. Drawn on the overlay layer
 * so it never forces a content/grid repaint. All coordinates are world mm, projected
 * through the viewport — the model stays in mm, this is display only.
 */
export function drawToolPreview(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  shapes: readonly PreviewShape[],
  palette: CanvasPalette,
): void {
  if (!ctx || shapes.length === 0) return
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  for (const shape of shapes) {
    if (shape.kind === 'segment') {
      ctx.strokeStyle = shape.ghost ? palette.cursor : palette.content
      ctx.lineWidth = shape.role === 'border' ? 2 : 1.25
      ctx.setLineDash(shape.ghost ? [5, 4] : [])
      const points = segmentToWorldPoints(shape.geometry)
      ctx.beginPath()
      points.forEach((p, i) => {
        const s = worldToScreen(vp, p)
        if (i === 0) ctx.moveTo(s.x, s.y)
        else ctx.lineTo(s.x, s.y)
      })
      ctx.stroke()
    } else {
      const s = worldToScreen(vp, shape.at)
      ctx.setLineDash([])
      ctx.fillStyle = palette.cursor
      ctx.fillRect(Math.round(s.x) - 2.5, Math.round(s.y) - 2.5, 5, 5)
    }
  }
  ctx.setLineDash([])
}

/** Half-size (screen px) of a snap glyph, and the text-hint offset from the snap point. */
const SNAP_GLYPH = 5

/** Human-readable label per snap kind, shown next to the marker (sentence case, lowercase). */
const SNAP_LABELS: Record<SnapKind, string> = {
  endpoint: 'endpoint',
  intersection: 'intersection',
  midpoint: 'midpoint',
  'on-curve': 'on curve',
  grid: 'grid',
  angle: 'angle',
}

/**
 * Draw the active snap marker (F-012): a distinct glyph per kind at the snap point (square =
 * endpoint, × = intersection, triangle = midpoint, circle = on-curve, plus = grid, diamond =
 * angle), any alignment/extension guide lines, and a short text hint by the cursor. Drawn on
 * the overlay layer in a single accent (cobalt) so it reads as chrome, not glass. Guarded on
 * a null 2D context so component tests under jsdom are unaffected.
 */
export function drawSnapMarker(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  hit: SnapHit | null,
  palette: CanvasPalette,
): void {
  if (!ctx || !hit) return
  ctx.save()
  ctx.strokeStyle = palette.snap
  ctx.fillStyle = palette.snap
  ctx.lineWidth = 1.5
  ctx.setLineDash([])

  // Alignment / extension guides (angle snap): faint dashed lines behind the glyph.
  if (hit.guides) {
    ctx.globalAlpha = 0.5
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    for (const [a, b] of hit.guides) {
      const sa = worldToScreen(vp, a)
      const sb = worldToScreen(vp, b)
      ctx.moveTo(sa.x, sa.y)
      ctx.lineTo(sb.x, sb.y)
    }
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }

  const s = worldToScreen(vp, hit.world)
  const g = SNAP_GLYPH
  ctx.beginPath()
  switch (hit.kind) {
    case 'endpoint':
      ctx.strokeRect(s.x - g, s.y - g, g * 2, g * 2)
      break
    case 'intersection':
      ctx.moveTo(s.x - g, s.y - g)
      ctx.lineTo(s.x + g, s.y + g)
      ctx.moveTo(s.x + g, s.y - g)
      ctx.lineTo(s.x - g, s.y + g)
      ctx.stroke()
      break
    case 'midpoint':
      ctx.moveTo(s.x, s.y - g)
      ctx.lineTo(s.x + g, s.y + g)
      ctx.lineTo(s.x - g, s.y + g)
      ctx.closePath()
      ctx.stroke()
      break
    case 'on-curve':
      ctx.arc(s.x, s.y, g, 0, Math.PI * 2)
      ctx.stroke()
      break
    case 'grid':
      ctx.moveTo(s.x - g, s.y)
      ctx.lineTo(s.x + g, s.y)
      ctx.moveTo(s.x, s.y - g)
      ctx.lineTo(s.x, s.y + g)
      ctx.stroke()
      break
    case 'angle':
      ctx.moveTo(s.x, s.y - g)
      ctx.lineTo(s.x + g, s.y)
      ctx.lineTo(s.x, s.y + g)
      ctx.lineTo(s.x - g, s.y)
      ctx.closePath()
      ctx.stroke()
      break
  }

  ctx.font = '11px "Geist Mono", ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(SNAP_LABELS[hit.kind], s.x + g + 4, s.y - g - 2)
  ctx.restore()
}

function rulerLabel(mm: number, unit: LengthUnit): string {
  if (unit === 'in') return formatFractionalInch(mm)
  const rounded = Math.round(mm * 100) / 100
  return String(rounded)
}

/**
 * Draw the top (horizontal) or left (vertical) ruler: a token-styled gutter with ticks
 * at nice, unit-aware intervals and a marker tracking the cursor (FR-3). `lengthPx` is
 * the extent along the ruler; the cross dimension is {@link RULER_SIZE}.
 */
export function drawRuler(
  ctx: CanvasRenderingContext2D | null,
  axis: 'x' | 'y',
  vp: Viewport,
  lengthPx: number,
  unit: LengthUnit,
  cursorScreen: Vec2 | null,
  palette: CanvasPalette,
): void {
  if (!ctx) return
  const horizontal = axis === 'x'
  const size: ViewSize = horizontal
    ? { width: lengthPx, height: RULER_SIZE }
    : { width: RULER_SIZE, height: lengthPx }

  ctx.fillStyle = palette.rulerBg
  ctx.fillRect(0, 0, size.width, size.height)

  const stepMm = rulerStepMm(vp.scale, unit)
  // World span along this axis. The ruler canvas shares its origin edge with the drawing
  // area, so the same viewport offset keeps ticks aligned with the grid — no gutter shift.
  const lo = horizontal ? (0 - vp.offset.x) / vp.scale : (0 - vp.offset.y) / vp.scale
  const hi = horizontal ? (lengthPx - vp.offset.x) / vp.scale : (lengthPx - vp.offset.y) / vp.scale

  ctx.strokeStyle = palette.rulerTick
  ctx.fillStyle = palette.rulerText
  ctx.lineWidth = 1
  ctx.font = '10px "Geist Mono", ui-monospace, monospace'
  ctx.textBaseline = 'alphabetic'

  for (const world of ticksInRange(Math.min(lo, hi), Math.max(lo, hi), stepMm)) {
    const pos = horizontal
      ? worldToScreen(vp, vec2(world, 0)).x
      : worldToScreen(vp, vec2(0, world)).y
    const label = rulerLabel(world, unit)

    ctx.beginPath()
    if (horizontal) {
      ctx.moveTo(crisp(pos), RULER_SIZE - 6)
      ctx.lineTo(crisp(pos), RULER_SIZE)
      ctx.stroke()
      ctx.textAlign = 'left'
      ctx.fillText(label, pos + 3, RULER_SIZE - 8)
    } else {
      ctx.moveTo(RULER_SIZE - 6, crisp(pos))
      ctx.lineTo(RULER_SIZE, crisp(pos))
      ctx.stroke()
      // Rotate labels to read bottom-to-top so long fractional-inch strings fit the gutter.
      ctx.save()
      ctx.translate(RULER_SIZE - 8, pos - 3)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'left'
      ctx.fillText(label, 0, 0)
      ctx.restore()
    }
  }

  // Border on the inner edge (against the canvas), and the cursor marker.
  ctx.strokeStyle = palette.rulerBorder
  ctx.beginPath()
  if (horizontal) {
    ctx.moveTo(0, crisp(RULER_SIZE))
    ctx.lineTo(lengthPx, crisp(RULER_SIZE))
  } else {
    ctx.moveTo(crisp(RULER_SIZE), 0)
    ctx.lineTo(crisp(RULER_SIZE), lengthPx)
  }
  ctx.stroke()

  if (cursorScreen) {
    ctx.strokeStyle = palette.cursor
    ctx.beginPath()
    if (horizontal) {
      ctx.moveTo(crisp(cursorScreen.x), 0)
      ctx.lineTo(crisp(cursorScreen.x), RULER_SIZE)
    } else {
      ctx.moveTo(0, crisp(cursorScreen.y))
      ctx.lineTo(RULER_SIZE, crisp(cursorScreen.y))
    }
    ctx.stroke()
  }
}
