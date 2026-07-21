import {
  formatArea,
  formatAreaLarge,
  formatLength,
  type BomReport,
  type CutListGroup,
  type GlassBomItem,
  type LengthUnit,
} from '@vitrum/core'
import { vec2 } from '@vitrum/geometry'

import { PageBuilder, type PageContent, type PdfDoc, type Stroke } from './page'
import { orientedSize, paperSize, type Orientation, type PaperSize } from './units'

/**
 * Compose a {@link BomReport} into a paginated {@link PdfDoc} (F-042): the cutting list (one glass per
 * section, with the swatch colour and piece dimensions in the display unit — FR-4) followed by the
 * bill of materials. Reuses `@vitrum/paper`'s page abstraction and pdf-lib backend, so no new PDF
 * code — the same pipeline F-041 prints with. Colours are physical ink-on-paper values (a PDF has no
 * design tokens), kept as named constants like the 1:1 print composer.
 */
const INK = '#111111'
const MUTED = '#555555'
const RULE = '#cccccc'
const PAPER = '#ffffff'

/** Options for {@link buildBomDocument}. */
export interface BomDocOptions {
  readonly projectName: string
  /** Display unit for lengths/areas (mm → cm²/m²; in → in²/ft²). */
  readonly unit: LengthUnit
  readonly paper?: PaperSize
  readonly orientation?: Orientation
  readonly includeCuttingList?: boolean
  readonly includeBom?: boolean
}

/** Layout constants (mm). */
const MARGIN = 15
const LINE = 5 // row height
const H1 = 15
const H2 = 10
const BODY = 8.5
const SMALL = 7.5

/**
 * A tiny paginating page builder: keeps a cursor down the page, opens a fresh sheet when a block
 * would overflow the bottom margin, and re-draws the running header on each new page.
 */
class Flow {
  readonly pages: PageContent[] = []
  #page!: PageBuilder
  #y = 0
  #index = 0

  constructor(
    readonly widthMm: number,
    readonly heightMm: number,
    readonly title: string,
  ) {
    this.#newPage()
  }

  get y(): number {
    return this.#y
  }

  #newPage(): void {
    if (this.pages.length > 0 || this.#index > 0)
      this.pages.push(this.#page.build(`bom-${this.#index}`))
    this.#page = new PageBuilder(this.widthMm, this.heightMm)
    this.#page.rect({ x: 0, y: 0, w: this.widthMm, h: this.heightMm }, { fill: { color: PAPER } })
    this.#index += 1
    this.#y = MARGIN
    // Running footer: document title, small and muted.
    this.#page.text(vec2(MARGIN, this.heightMm - MARGIN + 4), this.title, {
      sizePt: 6.5,
      color: MUTED,
      align: 'left',
    })
  }

  /** Ensure `h` mm of vertical room; page-break (returning true) when it would overflow. */
  ensure(h: number): boolean {
    if (this.#y + h <= this.heightMm - MARGIN) return false
    this.#newPage()
    return true
  }

  advance(h: number): void {
    this.#y += h
  }

  get page(): PageBuilder {
    return this.#page
  }

  finish(): PdfDoc {
    this.pages.push(this.#page.build(`bom-${this.#index}`))
    return { title: this.title, pages: this.pages }
  }
}

export function buildBomDocument(report: BomReport, options: BomDocOptions): PdfDoc {
  const paper = options.paper ?? paperSize('a4')!
  const { widthMm, heightMm } = orientedSize(paper, options.orientation ?? 'portrait')
  const flow = new Flow(widthMm, heightMm, `${options.projectName} — cutting list & BOM`)
  const contentW = widthMm - 2 * MARGIN

  title(flow, options.projectName)

  if (options.includeCuttingList !== false) drawCuttingList(flow, report, options.unit, contentW)
  if (options.includeBom !== false) drawBom(flow, report, options.unit, contentW)

  return flow.finish()
}

// --- Title -------------------------------------------------------------------

function title(flow: Flow, projectName: string): void {
  flow.page.text(vec2(MARGIN, flow.y + 4), projectName, {
    sizePt: H1,
    color: INK,
    align: 'left',
    bold: true,
  })
  flow.advance(9)
  flow.page.text(vec2(MARGIN, flow.y + 3), 'Cutting list & bill of materials', {
    sizePt: BODY,
    color: MUTED,
    align: 'left',
  })
  flow.advance(9)
}

// --- Cutting list ------------------------------------------------------------

function drawCuttingList(flow: Flow, report: BomReport, unit: LengthUnit, contentW: number): void {
  sectionHeading(flow, 'Cutting list')
  if (report.cutting.length === 0) {
    note(flow, 'No pieces detected yet. Draw a design and assign glass.')
    return
  }
  for (const group of report.cutting) drawGlassSection(flow, group, unit, contentW)
}

function drawGlassSection(
  flow: Flow,
  group: CutListGroup,
  unit: LengthUnit,
  contentW: number,
): void {
  // Keep the section header with at least its first row.
  flow.ensure(LINE * 3)

  // Swatch + code + name + count.
  const y = flow.y
  if (group.color) {
    flow.page.rect(
      { x: MARGIN, y: y - 0.5, w: 5, h: 5 },
      { fill: { color: group.color }, stroke: { color: INK, widthMm: 0.15 } },
    )
  }
  flow.page.text(vec2(MARGIN + 7, y + 3.5), group.code, {
    sizePt: H2,
    color: INK,
    align: 'left',
    font: 'mono',
    bold: true,
  })
  const maker = group.manufacturer ? ` · ${group.manufacturer}` : ''
  flow.page.text(vec2(MARGIN + 18, y + 3.5), `${group.name}${maker}`, {
    sizePt: BODY,
    color: INK,
    align: 'left',
  })
  flow.page.text(vec2(MARGIN + contentW, y + 3.5), `${group.count} pieces`, {
    sizePt: SMALL,
    color: MUTED,
    align: 'right',
  })
  flow.advance(LINE + 1)

  // Column layout (right edge of each numeric column).
  const cols = {
    no: MARGIN,
    width: MARGIN + contentW - 90,
    height: MARGIN + contentW - 45,
    area: MARGIN + contentW,
  }
  tableHeader(flow, cols)

  for (const row of group.rows) {
    if (flow.ensure(LINE)) tableHeader(flow, cols)
    const ry = flow.y
    flow.page.text(vec2(cols.no, ry + 3), row.label || '—', {
      sizePt: SMALL,
      color: INK,
      align: 'left',
      font: 'mono',
    })
    flow.page.text(vec2(cols.width, ry + 3), formatLength(row.widthMm, unit), {
      sizePt: SMALL,
      color: INK,
      align: 'right',
      font: 'mono',
    })
    flow.page.text(vec2(cols.height, ry + 3), formatLength(row.heightMm, unit), {
      sizePt: SMALL,
      color: INK,
      align: 'right',
      font: 'mono',
    })
    flow.page.text(vec2(cols.area, ry + 3), formatArea(row.areaMm2, unit), {
      sizePt: SMALL,
      color: INK,
      align: 'right',
      font: 'mono',
    })
    flow.advance(LINE)
  }

  // Subtotal + buy area.
  flow.ensure(LINE + 2)
  rule(flow)
  flow.advance(1.5)
  const sy = flow.y
  flow.page.text(vec2(cols.no, sy + 3), `Subtotal (${group.count} pieces)`, {
    sizePt: SMALL,
    color: MUTED,
    align: 'left',
  })
  flow.page.text(vec2(cols.area, sy + 3), formatArea(group.netAreaMm2, unit), {
    sizePt: SMALL,
    color: INK,
    align: 'right',
    font: 'mono',
    bold: true,
  })
  flow.advance(LINE)
  const by = flow.y
  flow.page.text(vec2(cols.no, by + 3), 'Buy (incl. waste)', {
    sizePt: SMALL,
    color: MUTED,
    align: 'left',
  })
  flow.page.text(vec2(cols.area, by + 3), formatAreaLarge(group.buyAreaMm2, unit), {
    sizePt: SMALL,
    color: INK,
    align: 'right',
    font: 'mono',
    bold: true,
  })
  flow.advance(LINE + 4)
}

function tableHeader(
  flow: Flow,
  cols: { no: number; width: number; height: number; area: number },
): void {
  const y = flow.y
  const h = (text: string, x: number, align: 'left' | 'right'): void => {
    flow.page.text(vec2(x, y + 2.5), text, {
      sizePt: 6.5,
      color: MUTED,
      align,
    })
  }
  h('No.', cols.no, 'left')
  h('Width', cols.width, 'right')
  h('Height', cols.height, 'right')
  h('Area', cols.area, 'right')
  flow.advance(LINE - 1)
  rule(flow)
  flow.advance(1)
}

// --- Bill of materials -------------------------------------------------------

function drawBom(flow: Flow, report: BomReport, unit: LengthUnit, contentW: number): void {
  flow.ensure(30)
  sectionHeading(flow, 'Bill of materials')

  // Glass.
  subHeading(flow, 'Glass')
  for (const item of report.glass) drawGlassBomRow(flow, item, unit, contentW)

  // Came (lead) or foil.
  if (report.technique === 'lead' && report.came.length > 0) {
    subHeading(flow, 'Lead came')
    for (const came of report.came) {
      flow.ensure(LINE)
      const y = flow.y
      const dims = `${came.name} (${came.kind}, flange ${formatLength(came.flangeMm, unit)}, heart ${formatLength(came.heartMm, unit)})`
      flow.page.text(vec2(MARGIN, y + 3), dims, { sizePt: SMALL, color: INK, align: 'left' })
      flow.page.text(
        vec2(MARGIN + contentW, y + 3),
        `${formatLength(came.buyLengthMm, unit)} (net ${formatLength(came.netLengthMm, unit)})`,
        {
          sizePt: SMALL,
          color: INK,
          align: 'right',
          font: 'mono',
        },
      )
      flow.advance(LINE)
    }
  } else if (report.technique === 'foil' && report.foil) {
    subHeading(flow, 'Copper foil')
    const foil = report.foil
    kv(
      flow,
      'Seam length',
      `${formatLength(foil.buySeamLengthMm, unit)} (net ${formatLength(foil.netSeamLengthMm, unit)})`,
      contentW,
    )
    kv(flow, 'Rolls', `${foil.rollsNeeded} × ${formatLength(foil.rollLengthMm, unit)}`, contentW)
    kv(
      flow,
      'Solder',
      `${round(foil.solderGrams)} g (${foil.solderGramsPerMetre} g/m of seam)`,
      contentW,
    )
  }

  // Reinforcement.
  if (report.reinforcement.length > 0) {
    subHeading(flow, 'Reinforcement bars')
    for (const bar of report.reinforcement) {
      kv(flow, `${bar.material} (${bar.count})`, formatLength(bar.totalLengthMm, unit), contentW)
    }
  }

  // Panel weight (from F-032).
  subHeading(flow, 'Panel weight (estimated)')
  kv(flow, 'Total', formatWeight(report.weight.grams), contentW)
  kv(flow, 'Glass', formatWeight(report.weight.glassGrams), contentW)
  kv(
    flow,
    report.technique === 'foil' ? 'Foil + solder' : 'Lead',
    formatWeight(report.weight.leadGrams),
    contentW,
  )

  // Estimation factors (documented, FR-5).
  subHeading(flow, 'Estimation factors')
  note(
    flow,
    `Glass waste +${pct(report.factors.glassWaste)} · came/foil waste +${pct(report.factors.leadWaste)} · solder ${report.factors.solderGramsPerMetre} g per metre of foil seam · foil roll ${formatLength(report.factors.foilRollLengthMm, unit)}.`,
  )
}

function drawGlassBomRow(flow: Flow, item: GlassBomItem, unit: LengthUnit, contentW: number): void {
  flow.ensure(LINE)
  const y = flow.y
  if (item.color) {
    flow.page.rect(
      { x: MARGIN, y: y - 0.5, w: 4, h: 4 },
      { fill: { color: item.color }, stroke: { color: INK, widthMm: 0.15 } },
    )
  }
  flow.page.text(vec2(MARGIN + 6, y + 3), `${item.code}  ${item.name}`, {
    sizePt: SMALL,
    color: INK,
    align: 'left',
  })
  const parts: string[] = [formatAreaLarge(item.buyAreaMm2, unit)]
  if (item.sheet)
    parts.push(
      `${item.sheet.sheetsNeeded} sheet(s) ${formatLength(item.sheet.widthMm, unit)}×${formatLength(item.sheet.heightMm, unit)}`,
    )
  if (item.cost !== undefined) parts.push(`${round(item.cost)}`)
  flow.page.text(vec2(MARGIN + contentW, y + 3), parts.join(' · '), {
    sizePt: SMALL,
    color: INK,
    align: 'right',
    font: 'mono',
  })
  flow.advance(LINE)
}

// --- Shared primitives -------------------------------------------------------

function sectionHeading(flow: Flow, text: string): void {
  flow.ensure(H2 + 4)
  flow.advance(3)
  flow.page.text(vec2(MARGIN, flow.y + 4), text, {
    sizePt: H2,
    color: INK,
    align: 'left',
    bold: true,
  })
  flow.advance(H2 - 3)
  rule(flow, INK, 0.4)
  flow.advance(3)
}

function subHeading(flow: Flow, text: string): void {
  flow.ensure(LINE + 3)
  flow.advance(2)
  flow.page.text(vec2(MARGIN, flow.y + 3), text.toUpperCase(), {
    sizePt: 6.5,
    color: MUTED,
    align: 'left',
    bold: true,
  })
  flow.advance(LINE)
}

function kv(flow: Flow, key: string, value: string, contentW: number): void {
  flow.ensure(LINE)
  const y = flow.y
  flow.page.text(vec2(MARGIN, y + 3), key, { sizePt: SMALL, color: MUTED, align: 'left' })
  flow.page.text(vec2(MARGIN + contentW, y + 3), value, {
    sizePt: SMALL,
    color: INK,
    align: 'right',
    font: 'mono',
  })
  flow.advance(LINE)
}

function note(flow: Flow, text: string): void {
  flow.ensure(LINE)
  flow.page.text(vec2(MARGIN, flow.y + 3), text, { sizePt: SMALL, color: MUTED, align: 'left' })
  flow.advance(LINE)
}

function rule(flow: Flow, color = RULE, widthMm = 0.2): void {
  const stroke: Stroke = { color, widthMm }
  flow.page.line(vec2(MARGIN, flow.y), vec2(flow.widthMm - MARGIN, flow.y), stroke)
}

function round(n: number): string {
  return (Math.round(n * 100) / 100).toString()
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

function formatWeight(grams: number): string {
  return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`
}
