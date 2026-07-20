import type { Vec2 } from '@vitrum/geometry'
import { signedArea } from '@vitrum/geometry'
import {
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  PDFDocument,
  type PDFFont,
  type PDFPage,
  rgb,
  StandardFonts,
} from 'pdf-lib'

import type { DrawOp, Fill, PageContent, PdfDoc, RectMm, Stroke } from './page'
import { mmToPt, PT_PER_MM } from './units'

/**
 * The pdf-lib backend for the drawing abstraction (F-041): render a {@link PdfDoc} to real, vector
 * PDF bytes (FR-5 — no rasterisation). This is the only module that knows pdf-lib or PDF's
 * bottom-left, y-up coordinate space; every other module works in top-left, y-down millimetres.
 * Text is embedded with the standard PDF fonts, so glyphs stay selectable and the file stays small.
 */

interface Fonts {
  readonly sans: PDFFont
  readonly sansBold: PDFFont
  readonly mono: PDFFont
  readonly monoBold: PDFFont
}

export async function renderPdf(doc: PdfDoc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(doc.title)
  pdf.setCreator('Vitrum')
  const fonts: Fonts = {
    sans: await pdf.embedFont(StandardFonts.Helvetica),
    sansBold: await pdf.embedFont(StandardFonts.HelveticaBold),
    mono: await pdf.embedFont(StandardFonts.Courier),
    monoBold: await pdf.embedFont(StandardFonts.CourierBold),
  }

  for (const content of doc.pages) renderPage(pdf, content, fonts)

  return pdf.save()
}

function renderPage(pdf: PDFDocument, content: PageContent, fonts: Fonts): void {
  const heightPt = mmToPt(content.heightMm)
  const page = pdf.addPage([mmToPt(content.widthMm), heightPt])
  const y = (mm: number): number => heightPt - mmToPt(mm)
  renderOps(page, content.ops, { heightPt, y, fonts })
}

interface Ctx {
  readonly heightPt: number
  readonly y: (mm: number) => number
  readonly fonts: Fonts
}

function renderOps(page: PDFPage, ops: readonly DrawOp[], ctx: Ctx): void {
  for (const op of ops) renderOp(page, op, ctx)
}

function renderOp(page: PDFPage, op: DrawOp, ctx: Ctx): void {
  switch (op.kind) {
    case 'polyline':
      renderPolyline(page, op.points, op.stroke, op.close ?? false, ctx)
      break
    case 'polygon':
      renderPolygon(page, op.ring, op.holes ?? [], op.fill, op.stroke, ctx)
      break
    case 'rect':
      renderRect(page, op.rect, op.fill, op.stroke, ctx)
      break
    case 'circle':
      renderCircle(page, op.center, op.radiusMm, op.fill, op.stroke, ctx)
      break
    case 'text':
      renderText(page, op, ctx)
      break
    case 'group':
      renderGroup(page, op.ops, op.clip, ctx)
      break
  }
}

function renderGroup(
  page: PDFPage,
  ops: readonly DrawOp[],
  clipRect: RectMm | undefined,
  ctx: Ctx,
): void {
  if (!clipRect) {
    renderOps(page, ops, ctx)
    return
  }
  const x0 = mmToPt(clipRect.x)
  const x1 = mmToPt(clipRect.x + clipRect.w)
  const yTop = ctx.y(clipRect.y)
  const yBot = ctx.y(clipRect.y + clipRect.h)
  page.pushOperators(
    pushGraphicsState(),
    moveTo(x0, yBot),
    lineTo(x1, yBot),
    lineTo(x1, yTop),
    lineTo(x0, yTop),
    closePath(),
    clip(),
    endPath(),
  )
  renderOps(page, ops, ctx)
  page.pushOperators(popGraphicsState())
}

function renderPolyline(
  page: PDFPage,
  points: readonly Vec2[],
  stroke: Stroke,
  close: boolean,
  ctx: Ctx,
): void {
  if (points.length < 2) return
  const color = hex(stroke.color)
  const thickness = mmToPt(stroke.widthMm)
  const dashArray = stroke.dashMm?.map(mmToPt)
  const seq = close ? [...points, points[0]!] : points
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i]!
    const b = seq[i + 1]!
    page.drawLine({
      start: { x: mmToPt(a.x), y: ctx.y(a.y) },
      end: { x: mmToPt(b.x), y: ctx.y(b.y) },
      thickness,
      color,
      ...(dashArray ? { dashArray } : {}),
    })
  }
}

function renderPolygon(
  page: PDFPage,
  ring: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
  fill: Fill | undefined,
  stroke: Stroke | undefined,
  ctx: Ctx,
): void {
  if (ring.length < 3) return
  // drawSvgPath interprets the path in y-down space anchored at (x, y) and scaled; placing it at the
  // page top with scale = PT_PER_MM maps path-millimetres to the same coordinates as our y() flip.
  const path = svgRing(ring, fill) + holes.map((h) => svgRing(h, fill, ring)).join('')
  page.drawSvgPath(path, {
    x: 0,
    y: ctx.heightPt,
    scale: PT_PER_MM,
    ...(fill ? { color: hex(fill.color) } : {}),
    ...(stroke ? { borderColor: hex(stroke.color), borderWidth: stroke.widthMm } : {}),
  })
}

/**
 * Build an SVG subpath for a ring. When filling, holes are emitted with winding opposite the outer
 * ring so pdf-lib's nonzero fill punches them out (it has no even-odd option on `drawSvgPath`).
 */
function svgRing(ring: readonly Vec2[], fill: Fill | undefined, outer?: readonly Vec2[]): string {
  let pts = ring
  if (fill && outer) {
    const outerSign = Math.sign(signedArea(outer))
    const holeSign = Math.sign(signedArea(ring))
    if (outerSign !== 0 && holeSign === outerSign) pts = [...ring].reverse()
  }
  const [first, ...rest] = pts
  if (!first) return ''
  return (
    `M ${num(first.x)} ${num(first.y)} ` +
    rest.map((p) => `L ${num(p.x)} ${num(p.y)}`).join(' ') +
    ' Z '
  )
}

function renderRect(
  page: PDFPage,
  rect: RectMm,
  fill: Fill | undefined,
  stroke: Stroke | undefined,
  ctx: Ctx,
): void {
  page.drawRectangle({
    x: mmToPt(rect.x),
    y: ctx.y(rect.y + rect.h),
    width: mmToPt(rect.w),
    height: mmToPt(rect.h),
    ...(fill ? { color: hex(fill.color) } : {}),
    ...(stroke ? { borderColor: hex(stroke.color), borderWidth: mmToPt(stroke.widthMm) } : {}),
    ...(stroke?.dashMm ? { borderDashArray: stroke.dashMm.map(mmToPt) } : {}),
  })
}

function renderCircle(
  page: PDFPage,
  center: Vec2,
  radiusMm: number,
  fill: Fill | undefined,
  stroke: Stroke | undefined,
  ctx: Ctx,
): void {
  page.drawCircle({
    x: mmToPt(center.x),
    y: ctx.y(center.y),
    size: mmToPt(radiusMm),
    ...(fill ? { color: hex(fill.color) } : {}),
    ...(stroke ? { borderColor: hex(stroke.color), borderWidth: mmToPt(stroke.widthMm) } : {}),
  })
}

function renderText(page: PDFPage, op: Extract<DrawOp, { kind: 'text' }>, ctx: Ctx): void {
  const font = pickFont(op.font ?? 'sans', op.bold ?? false, ctx.fonts)
  const size = op.sizePt
  const width = font.widthOfTextAtSize(op.text, size)
  let x = mmToPt(op.at.x)
  if (op.align === 'center') x -= width / 2
  else if (op.align === 'right') x -= width

  const anchorY = ctx.y(op.at.y)
  let baselineY = anchorY
  if (op.baseline === 'middle') baselineY = anchorY - size * 0.35
  else if (op.baseline === 'top') baselineY = anchorY - size * 0.8

  page.drawText(op.text, { x, y: baselineY, size, font, color: hex(op.color) })
}

function pickFont(family: 'sans' | 'mono', bold: boolean, fonts: Fonts): PDFFont {
  if (family === 'mono') return bold ? fonts.monoBold : fonts.mono
  return bold ? fonts.sansBold : fonts.sans
}

/** Parse a `#rgb` or `#rrggbb` hex colour to a pdf-lib `rgb` (0..1). Defaults to black. */
function hex(value: string): ReturnType<typeof rgb> {
  const m = value.trim().replace(/^#/, '')
  const full = m.length === 3 ? m.replace(/(.)/g, '$1$1') : m
  if (full.length !== 6) return rgb(0, 0, 0)
  const r = parseInt(full.slice(0, 2), 16) / 255
  const g = parseInt(full.slice(2, 4), 16) / 255
  const b = parseInt(full.slice(4, 6), 16) / 255
  return rgb(r, g, b)
}

/** Format a number for an SVG path with enough precision for print fidelity. */
function num(v: number): string {
  return Number.isFinite(v) ? v.toFixed(4) : '0'
}
