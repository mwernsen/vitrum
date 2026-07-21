import { flattenCurve, vec2, type Vec2 } from '@vitrum/geometry'

import type { ExportPdfOptions, ExportScene } from './exportScene'
import { PageBuilder, type PdfDoc, type Stroke } from './page'
import { mmToPt, orientedSize } from './units'

/**
 * Single-sheet PDF export (F-043) — distinct from F-041's tiled 1:1 print. Produces one page holding
 * the whole design, either at **actual size** (a custom sheet exactly the panel size plus a margin,
 * so a poster shop prints it 1:1) or **scaled to fit** a named page with the scale factor printed on
 * it. Colours (render) or monochrome (cartoon). Reuses the `@vitrum/paper` {@link PdfDoc} model and
 * pdf-lib backend — no new PDF code (the F-041 pipeline).
 */
const INK = '#111111'
const PAPER = '#ffffff'
const MUTED = '#555555'
const LEAD_MIN_MM = 0.4
const BORDER_MM = 0.9
/** Flattening tolerance (mm) for arcs/cubics drawn to the PDF. */
const FLATTEN_TOL_MM = 0.1

export function buildExportPdfDocument(scene: ExportScene, options: ExportPdfOptions): PdfDoc {
  const b = scene.contentBounds
  const panelW = Math.max(1e-6, b.max.x - b.min.x)
  const panelH = Math.max(1e-6, b.max.y - b.min.y)
  const margin = Math.max(0, options.marginMm)

  let pageWidthMm: number
  let pageHeightMm: number
  let scale: number
  if (options.scaleMode === 'actual') {
    pageWidthMm = panelW + 2 * margin
    pageHeightMm = panelH + 2 * margin
    scale = 1
  } else {
    const oriented = orientedSize(options.paper, options.orientation)
    pageWidthMm = oriented.widthMm
    pageHeightMm = oriented.heightMm
    const printableW = Math.max(1, pageWidthMm - 2 * margin)
    const printableH = Math.max(1, pageHeightMm - 2 * margin)
    scale = Math.min(printableW / panelW, printableH / panelH)
  }

  const drawnW = panelW * scale
  const drawnH = panelH * scale
  const ox = (pageWidthMm - drawnW) / 2
  const oy = (pageHeightMm - drawnH) / 2
  const toPage = (p: Vec2): Vec2 => vec2(ox + (p.x - b.min.x) * scale, oy + (p.y - b.min.y) * scale)

  const page = new PageBuilder(pageWidthMm, pageHeightMm)
  page.rect({ x: 0, y: 0, w: pageWidthMm, h: pageHeightMm }, { fill: { color: PAPER } })

  // Glass fills (render look only), below the line work.
  if (options.look === 'render') {
    for (const piece of orderedPieces(scene)) {
      if (!piece.fillColor || piece.ring.length < 3) continue
      const ring = piece.ring.map(toPage)
      const holes = piece.holeRings.filter((h) => h.length >= 3).map((h) => h.map(toPage))
      page.polygon(ring, { holes, fill: { color: piece.fillColor, evenOdd: true } })
    }
  }

  // Lead-line network.
  for (const seg of orderedSegments(scene)) {
    if (seg.role === 'construction') continue
    const stroke: Stroke = {
      color: INK,
      widthMm: seg.role === 'border' ? BORDER_MM : Math.max(LEAD_MIN_MM, seg.widthMm),
    }
    const pts = flattenCurve(seg.geometry, FLATTEN_TOL_MM).map(toPage)
    page.polyline(pts, stroke)
  }

  // Piece numbers.
  if (options.includeNumbers) {
    const sizePt = clamp(5, 14, mmToPt(3 * scale))
    for (const piece of orderedPieces(scene)) {
      if (!piece.label || !piece.labelAt) continue
      page.text(toPage(piece.labelAt), piece.label, {
        sizePt,
        color: INK,
        align: 'center',
        baseline: 'middle',
        font: 'mono',
        bold: true,
      })
    }
  }

  // Title + scale caption in the bottom margin.
  const caption =
    options.scaleMode === 'actual'
      ? 'actual size (1:1) — print at 100%, do not "fit to page"'
      : `scaled to fit · scale ${scaleLabel(scale)} — not to physical size`
  page.text(
    vec2(margin > 2 ? margin : 3, pageHeightMm - 3),
    `${options.projectName}  ·  ${caption}`,
    {
      sizePt: 7,
      color: MUTED,
      align: 'left',
    },
  )

  return { title: `${options.projectName} — export`, pages: [page.build('export')] }
}

/** A human scale label, e.g. `1:2.5` or `2:1`. */
function scaleLabel(scale: number): string {
  if (scale >= 1) return `${round(scale)}:1`
  return `1:${round(1 / scale)}`
}

function round(n: number): string {
  return (Math.round(n * 100) / 100).toString()
}

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v))
}

function orderedSegments(scene: ExportScene): ExportScene['segments'] {
  return [...scene.segments].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function orderedPieces(scene: ExportScene): ExportScene['pieces'] {
  return [...scene.pieces].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}
