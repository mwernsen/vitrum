import type { BBox, Vec2 } from '@vitrum/geometry'
import { vec2 } from '@vitrum/geometry'

import { clipPolygon, clipPolyline } from './clip'
import { PageBuilder, type PageContent, type PdfDoc, type RectMm, type Stroke } from './page'
import {
  CALIBRATION_LENGTH_MM,
  type LegendRow,
  type PrintOptions,
  type PrintScene,
  type ScenePiece,
} from './scene'
import { computeTiling, internalSeams, tileLabel, type Tile, type Tiling } from './tiling'
import { orientedSize, PT_PER_MM } from './units'

/**
 * Compose a {@link PrintScene} into a page-per-tile {@link PdfDoc} (F-041). Colours here are physical
 * **ink-on-paper** values, not screen chrome: a PDF has no CSS custom properties, and printed output
 * is data/output (token-exempt, like rendered document content on the canvas). They are kept as
 * named constants so the intent is explicit.
 */
const INK = '#111111' // line work, numbers, labels
const FOLD = '#8a8a8a' // dashed seam / fold guides
const MARK = '#111111' // crop marks & registration crosshairs (must be crisp)
const PAPER = '#ffffff'

/** Line weights (mm) for the derived views. */
const LEAD_MIN_MM = 0.4
const BORDER_MM = 0.9
const CUT_MM = 0.3

/**
 * Build the full print document: an optional overview map page first, then one page per tile in
 * reading order (row-major, `A1, B1, … A2 …`).
 */
export function buildPrintDocument(scene: PrintScene, options: PrintOptions): PdfDoc {
  const { widthMm: pageWidthMm, heightMm: pageHeightMm } = orientedSize(
    options.paper,
    options.orientation,
  )
  const tiling = computeTiling({
    contentBounds: scene.contentBounds,
    pageWidthMm,
    pageHeightMm,
    marginMm: options.marginMm,
    overlapMm: options.overlapMm,
  })

  const pages: PageContent[] = []
  if (options.include.overviewMap) pages.push(buildOverviewPage(scene, options, tiling))
  for (const tile of tiling.tiles) pages.push(buildTilePage(scene, options, tiling, tile))

  return { title: `${options.projectName} — 1:1 print`, pages }
}

// --- One tile page -----------------------------------------------------------

function buildTilePage(
  scene: PrintScene,
  options: PrintOptions,
  tiling: Tiling,
  tile: Tile,
): PageContent {
  const page = new PageBuilder(tiling.pageWidthMm, tiling.pageHeightMm)
  const { include } = options

  // White sheet.
  page.rect(
    { x: 0, y: 0, w: tiling.pageWidthMm, h: tiling.pageHeightMm },
    { fill: { color: PAPER } },
  )

  const printable = tile.printable
  const wr = tile.worldRect
  const toPage = (p: Vec2): Vec2 => vec2(printable.x + (p.x - wr.x), printable.y + (p.y - wr.y))

  // Content, geometry-clipped to the tile's world rect and also clip-grouped on the page so no
  // stroke or glyph can bleed into the margins where the marks live.
  page.group(printable, (g) => {
    drawSceneContent(g, scene, options, wr, toPage)
    if (include.alignmentMarks) drawRegistration(g, tiling, tile, toPage)
  })

  // Chrome in the margins.
  if (include.alignmentMarks) drawCropMarks(page, printable)
  if (include.pageLabels) drawPageLabel(page, tiling, tile)
  if (include.calibrationRuler) drawCalibrationRuler(page, tiling)

  return page.build(tile.label)
}

/** Draw the network / cut lines / fills / numbers for a tile, clipped to its world rect. */
function drawSceneContent(
  g: PageBuilder,
  scene: PrintScene,
  options: PrintOptions,
  wr: RectMm,
  toPage: (p: Vec2) => Vec2,
): void {
  // Glass fills (render mode only), below the line work.
  if (options.content === 'render') {
    for (const piece of scene.pieces) {
      if (!piece.fillColor) continue
      const ring = clipPolygon(piece.ring, wr).map(toPage)
      if (ring.length < 3) continue
      const holes = piece.holeRings
        .map((h) => clipPolygon(h, wr).map(toPage))
        .filter((h) => h.length >= 3)
      g.polygon(ring, { holes, fill: { color: piece.fillColor, evenOdd: true } })
    }
  }

  if (options.content === 'cut') {
    for (const ring of scene.cutLines) {
      // Cut rings are closed; clip as a closed polyline so both open ends re-enter cleanly.
      for (const run of clipPolyline([...ring, ring[0]!], wr)) {
        g.polyline(run.map(toPage), { color: INK, widthMm: CUT_MM })
      }
    }
  } else {
    for (const seg of scene.network) {
      if (seg.role === 'construction') continue
      const stroke: Stroke = {
        color: INK,
        widthMm: seg.role === 'border' ? BORDER_MM : Math.max(LEAD_MIN_MM, seg.widthMm),
      }
      for (const run of clipPolyline(seg.points, wr)) g.polyline(run.map(toPage), stroke)
    }
  }

  if (options.include.numbers) {
    const inset: RectMm = {
      x: wr.x + 2,
      y: wr.y + 2,
      w: Math.max(0, wr.w - 4),
      h: Math.max(0, wr.h - 4),
    }
    for (const piece of scene.pieces) drawPieceNumber(g, piece, inset, toPage)
  }
}

/** Draw one piece's number: inline at its pole when it fits, else with a short leader. */
function drawPieceNumber(
  g: PageBuilder,
  piece: ScenePiece,
  inset: RectMm,
  toPage: (p: Vec2) => Vec2,
): void {
  if (!piece.label || !piece.labelAt) return
  const at = piece.labelAt
  if (at.x < inset.x || at.x > inset.x + inset.w || at.y < inset.y || at.y > inset.y + inset.h)
    return
  const radiusPt = (piece.labelRadiusMm ?? 0) * PT_PER_MM
  const p = toPage(at)

  if (radiusPt >= 6) {
    const sizePt = clamp(6, 16, radiusPt * 1.1)
    g.text(p, piece.label, {
      sizePt,
      color: INK,
      align: 'center',
      baseline: 'middle',
      font: 'mono',
      bold: true,
    })
    return
  }

  // Too small for an inline label: a leader up-and-right to a minimum-size label.
  const offMm = 3
  const lx = vec2(p.x + offMm, p.y - offMm)
  g.line(p, lx, { color: INK, widthMm: 0.2 })
  g.circle(p, 0.4, { fill: { color: INK } })
  g.text(vec2(lx.x + 0.5, lx.y), piece.label, {
    sizePt: 6,
    color: INK,
    align: 'left',
    baseline: 'middle',
    font: 'mono',
    bold: true,
  })
}

// --- Alignment marks ---------------------------------------------------------

/**
 * Registration crosshairs and dashed fold lines at each seam that passes through this tile. Because
 * the marks are placed at fixed world coordinates in the shared overlap band, both sheets of a seam
 * draw them identically; when the bands are taped together they coincide, and any printer scaling
 * makes them visibly miss (FR-2).
 */
function drawRegistration(
  g: PageBuilder,
  tiling: Tiling,
  tile: Tile,
  toPage: (p: Vec2) => Vec2,
): void {
  const wr = tile.worldRect
  const foldStroke: Stroke = { color: FOLD, widthMm: 0.2, dashMm: [3, 2] }
  for (const seam of internalSeams(tiling)) {
    if (seam.orientation === 'vertical') {
      if (seam.centreMm < wr.x || seam.centreMm > wr.x + wr.w) continue
      const top = toPage(vec2(seam.centreMm, wr.y))
      const bottom = toPage(vec2(seam.centreMm, wr.y + wr.h))
      g.line(top, bottom, foldStroke)
      for (const f of [0.15, 0.5, 0.85]) crosshair(g, toPage(vec2(seam.centreMm, wr.y + f * wr.h)))
    } else {
      if (seam.centreMm < wr.y || seam.centreMm > wr.y + wr.h) continue
      const left = toPage(vec2(wr.x, seam.centreMm))
      const right = toPage(vec2(wr.x + wr.w, seam.centreMm))
      g.line(left, right, foldStroke)
      for (const f of [0.15, 0.5, 0.85]) crosshair(g, toPage(vec2(wr.x + f * wr.w, seam.centreMm)))
    }
  }
}

/** A small registration crosshair (a plus inside a circle) centred at a page point. */
function crosshair(g: PageBuilder, c: Vec2): void {
  const arm = 3
  const stroke: Stroke = { color: MARK, widthMm: 0.25 }
  g.line(vec2(c.x - arm, c.y), vec2(c.x + arm, c.y), stroke)
  g.line(vec2(c.x, c.y - arm), vec2(c.x, c.y + arm), stroke)
  g.circle(c, 1.6, { stroke })
}

/** Crop ticks just outside each corner of the printable rectangle. */
function drawCropMarks(page: PageBuilder, printable: RectMm): void {
  const len = 4
  const gap = 1.5
  const stroke: Stroke = { color: MARK, widthMm: 0.3 }
  const corners: Array<[number, number, number, number]> = [
    [printable.x, printable.y, -1, -1],
    [printable.x + printable.w, printable.y, 1, -1],
    [printable.x, printable.y + printable.h, -1, 1],
    [printable.x + printable.w, printable.y + printable.h, 1, 1],
  ]
  for (const [x, y, sx, sy] of corners) {
    page.line(vec2(x + sx * gap, y), vec2(x + sx * (gap + len), y), stroke)
    page.line(vec2(x, y + sy * gap), vec2(x, y + sy * (gap + len)), stroke)
  }
}

/** The page coordinate label and "join to neighbour" arrows in the margins. */
function drawPageLabel(page: PageBuilder, tiling: Tiling, tile: Tile): void {
  const m = tiling.marginMm
  page.text(vec2(m, m - 3), tile.label, { sizePt: 13, color: INK, align: 'left', bold: true })
  const sheetNo = tile.row * tiling.cols + tile.col + 1
  page.text(vec2(m + 20, m - 3.5), `sheet ${sheetNo} of ${tiling.tiles.length}`, {
    sizePt: 7,
    color: INK,
    align: 'left',
  })

  const printableRight = m + tiling.contentWidthMm
  const printableBottom = m + tiling.contentHeightMm
  if (tile.col < tiling.cols - 1) {
    page.text(
      vec2(printableRight + 1, printableBottom / 2 + m / 2),
      `${tileLabel(tile.col + 1, tile.row)} >`,
      { sizePt: 7, color: INK, align: 'left' },
    )
  }
  if (tile.row < tiling.rows - 1) {
    page.text(
      vec2((m + printableRight) / 2, printableBottom + 5),
      `v ${tileLabel(tile.col, tile.row + 1)}`,
      { sizePt: 7, color: INK, align: 'center' },
    )
  }
}

/**
 * A true-size calibration ruler in the bottom margin: a 100 mm baseline with 10 mm ticks. If the
 * printer scales the page ("fit to page"), this will not measure 100 mm — the FR-1 physical check.
 */
function drawCalibrationRuler(page: PageBuilder, tiling: Tiling): void {
  const len = Math.min(CALIBRATION_LENGTH_MM, tiling.contentWidthMm)
  const x0 = tiling.marginMm
  const y = tiling.pageHeightMm - tiling.marginMm + 5.5
  const stroke: Stroke = { color: INK, widthMm: 0.3 }
  page.line(vec2(x0, y), vec2(x0 + len, y), stroke)
  for (let mm = 0; mm <= len; mm += 10) {
    const h = mm % 50 === 0 ? 2.2 : 1.3
    page.line(vec2(x0 + mm, y - h), vec2(x0 + mm, y), stroke)
  }
  page.text(vec2(x0 + len + 2, y), `${len} mm — print at 100%, do not "fit to page"`, {
    sizePt: 6.5,
    color: INK,
    align: 'left',
  })
}

// --- Overview map page -------------------------------------------------------

function buildOverviewPage(scene: PrintScene, options: PrintOptions, tiling: Tiling): PageContent {
  const page = new PageBuilder(tiling.pageWidthMm, tiling.pageHeightMm)
  const m = tiling.marginMm
  page.rect(
    { x: 0, y: 0, w: tiling.pageWidthMm, h: tiling.pageHeightMm },
    { fill: { color: PAPER } },
  )

  page.text(vec2(m, m + 2), `${options.projectName} — 1:1 print`, {
    sizePt: 15,
    color: INK,
    align: 'left',
    bold: true,
  })
  const overlap = tiling.overlapMm
  page.text(
    vec2(m, m + 9),
    `${tiling.cols}×${tiling.rows} tiles · ${options.paper.label} ${options.orientation} · overlap ${overlap} mm · content ${options.content}`,
    { sizePt: 8, color: INK, align: 'left' },
  )

  // A scaled thumbnail of the panel with the tile grid overlaid.
  const legendRows = options.include.glassCodes ? scene.legend : []
  const boxTop = m + 16
  const legendHeight = legendRows.length > 0 ? Math.min(60, 6 + legendRows.length * 5) : 0
  const boxBottom = tiling.pageHeightMm - m - legendHeight - 8
  const box: RectMm = {
    x: m,
    y: boxTop,
    w: tiling.contentWidthMm,
    h: Math.max(20, boxBottom - boxTop),
  }
  drawOverviewThumbnail(page, scene, tiling, box)

  if (legendRows.length > 0) drawLegend(page, legendRows, m, boxBottom + 6)
  if (options.include.calibrationRuler) drawCalibrationRuler(page, tiling)

  return page.build('overview')
}

function drawOverviewThumbnail(
  page: PageBuilder,
  scene: PrintScene,
  tiling: Tiling,
  box: RectMm,
): void {
  const b = scene.contentBounds
  const panelW = Math.max(1e-6, b.max.x - b.min.x)
  const panelH = Math.max(1e-6, b.max.y - b.min.y)
  const scale = Math.min(box.w / panelW, box.h / panelH)
  const drawnW = panelW * scale
  const drawnH = panelH * scale
  const ox = box.x + (box.w - drawnW) / 2
  const oy = box.y
  const toBox = (p: Vec2): Vec2 => vec2(ox + (p.x - b.min.x) * scale, oy + (p.y - b.min.y) * scale)

  // Panel outline.
  page.rect({ x: ox, y: oy, w: drawnW, h: drawnH }, { stroke: { color: INK, widthMm: 0.3 } })

  // A light rendition of the network.
  for (const seg of scene.network) {
    if (seg.role === 'construction') continue
    page.polyline(seg.points.map(toBox), { color: INK, widthMm: 0.2 })
  }

  // Tile grid (step layout) + cell labels.
  const cellStroke: Stroke = { color: FOLD, widthMm: 0.25, dashMm: [2, 1.5] }
  for (const tile of tiling.tiles) {
    const x0 = b.min.x + tile.col * tiling.stepXMm
    const y0 = b.min.y + tile.row * tiling.stepYMm
    const tl = toBox(vec2(x0, y0))
    const w = tiling.contentWidthMm * scale
    const h = tiling.contentHeightMm * scale
    page.rect({ x: tl.x, y: tl.y, w, h }, { stroke: cellStroke })
    page.text(vec2(tl.x + w / 2, tl.y + h / 2), tile.label, {
      sizePt: 9,
      color: INK,
      align: 'center',
      bold: true,
    })
  }
}

function drawLegend(page: PageBuilder, rows: readonly LegendRow[], x: number, y: number): void {
  page.text(vec2(x, y), 'Glass legend', { sizePt: 8, color: INK, align: 'left', bold: true })
  let cy = y + 5
  for (const row of rows) {
    if (row.color) {
      page.rect(
        { x, y: cy - 2.6, w: 3.2, h: 3.2 },
        { fill: { color: row.color }, stroke: { color: INK, widthMm: 0.15 } },
      )
    }
    page.text(vec2(x + 5, cy), row.code, {
      sizePt: 7.5,
      color: INK,
      align: 'left',
      font: 'mono',
      bold: true,
    })
    const maker = row.manufacturer ? ` - ${row.manufacturer}` : ''
    page.text(vec2(x + 13, cy), `${row.name}${maker}  (${row.count})`, {
      sizePt: 7.5,
      color: INK,
      align: 'left',
    })
    cy += 5
    if (cy > y + 60) break
  }
}

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v))
}

/** Re-export for consumers building the world bounds. */
export type { BBox }
