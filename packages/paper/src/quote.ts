import type { LengthUnit, QuoteLine, QuoteReport } from '@vitrum/core'
import { vec2 } from '@vitrum/geometry'

import { PageBuilder, type PageContent, type PdfDoc, type Stroke } from './page'
import { orientedSize, paperSize, type Orientation, type PaperSize } from './units'

/**
 * Compose a {@link QuoteReport} into a client-presentable quote PDF (F-056 FR-3) through the F-041
 * paper pipeline (`PageBuilder` + the pdf-lib backend — no new PDF code). The default (client) view
 * shows a header, an optional rendered panel image, one rolled-up "panel" line, any explicit manual
 * lines and the grand total — the **internal cost breakdown is excluded**. With `includeBreakdown`,
 * the full internal cost sheet is emitted instead (every material line, the transparent labor hours
 * breakdown, overhead and margin as explicit lines). Colours are physical ink values, like the other
 * paper composers.
 */
const INK = '#111111'
const MUTED = '#555555'
const RULE = '#cccccc'
const PAPER = '#ffffff'
const ACCENT = '#1f2937'

/** A rendered panel image to place at the top of the quote (the F-053/F-043 canvas snapshot). */
export interface QuotePanelImage {
  readonly data: Uint8Array
  readonly format: 'png' | 'jpg'
  /** Pixel dimensions, used to preserve aspect when fitting into the image box. */
  readonly widthPx: number
  readonly heightPx: number
}

/** Options for {@link buildQuoteDocument}. */
export interface QuoteDocOptions {
  readonly projectName: string
  readonly unit: LengthUnit
  /** Client / quote header fields. */
  readonly client: {
    readonly clientName: string
    readonly projectTitle: string
    readonly quoteNumber: string
    readonly notes: string
  }
  /** Quote date, stamped by the caller (kept out of the model so totals stay date-independent). */
  readonly date: string
  /** Include the internal cost breakdown (FR-3). Default false — the client view. */
  readonly includeBreakdown?: boolean
  /** Optional rendered panel snapshot placed below the header. */
  readonly panelImage?: QuotePanelImage
  readonly paper?: PaperSize
  readonly orientation?: Orientation
}

/** Layout constants (mm). */
const MARGIN = 18
const LINE = 6
const H1 = 17
const H2 = 10
const BODY = 9
const SMALL = 7.5
/** Max height for the optional panel image box (mm). */
const IMAGE_BOX_H = 70

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

  get page(): PageBuilder {
    return this.#page
  }

  #newPage(): void {
    if (this.pages.length > 0 || this.#index > 0)
      this.pages.push(this.#page.build(`quote-${this.#index}`))
    this.#page = new PageBuilder(this.widthMm, this.heightMm)
    this.#page.rect({ x: 0, y: 0, w: this.widthMm, h: this.heightMm }, { fill: { color: PAPER } })
    this.#index += 1
    this.#y = MARGIN
    this.#page.text(vec2(MARGIN, this.heightMm - MARGIN + 4), this.title, {
      sizePt: 6.5,
      color: MUTED,
      align: 'left',
    })
  }

  ensure(h: number): boolean {
    if (this.#y + h <= this.heightMm - MARGIN) return false
    this.#newPage()
    return true
  }

  advance(h: number): void {
    this.#y += h
  }

  finish(): PdfDoc {
    this.pages.push(this.#page.build(`quote-${this.#index}`))
    return { title: this.title, pages: this.pages }
  }
}

export function buildQuoteDocument(report: QuoteReport, options: QuoteDocOptions): PdfDoc {
  const paper = options.paper ?? paperSize('a4')!
  const { widthMm, heightMm } = orientedSize(paper, options.orientation ?? 'portrait')
  const title = `${options.client.projectTitle || options.projectName} — quote`
  const flow = new Flow(widthMm, heightMm, title)
  const contentW = widthMm - 2 * MARGIN
  const sym = report.currency.symbol

  header(flow, options, contentW)
  if (options.panelImage) panelImage(flow, options.panelImage, contentW)

  if (options.includeBreakdown) {
    breakdown(flow, report, sym, contentW)
  } else {
    clientLines(flow, report, sym, contentW)
  }

  totals(flow, report, sym, contentW, options.includeBreakdown ?? false)
  if (report.hasUnpricedGlass) {
    note(
      flow,
      'Note: one or more glasses in this design have no price set — the material total may understate the real cost.',
    )
  }
  if (options.client.notes.trim()) notesBlock(flow, options.client.notes, contentW)

  return flow.finish()
}

// --- Header ------------------------------------------------------------------

function header(flow: Flow, options: QuoteDocOptions, contentW: number): void {
  flow.page.text(vec2(MARGIN, flow.y + 5), options.client.projectTitle || options.projectName, {
    sizePt: H1,
    color: INK,
    align: 'left',
    bold: true,
  })
  flow.page.text(vec2(MARGIN + contentW, flow.y + 5), 'Quote', {
    sizePt: H2,
    color: MUTED,
    align: 'right',
  })
  flow.advance(11)

  const meta: string[] = []
  if (options.client.quoteNumber.trim()) meta.push(`No. ${options.client.quoteNumber}`)
  meta.push(options.date)
  if (options.client.clientName.trim()) meta.push(options.client.clientName)
  flow.page.text(vec2(MARGIN, flow.y + 3), meta.join('  ·  '), {
    sizePt: SMALL,
    color: MUTED,
    align: 'left',
  })
  flow.advance(LINE + 2)
  rule(flow, INK, 0.4)
  flow.advance(4)
}

function panelImage(flow: Flow, image: QuotePanelImage, contentW: number): void {
  const aspect = image.widthPx > 0 && image.heightPx > 0 ? image.widthPx / image.heightPx : 1
  let w = contentW
  let h = w / aspect
  if (h > IMAGE_BOX_H) {
    h = IMAGE_BOX_H
    w = h * aspect
  }
  flow.ensure(h + 4)
  const x = MARGIN + (contentW - w) / 2
  flow.page.image({ x, y: flow.y, w, h }, image.data, image.format)
  flow.advance(h + 6)
}

// --- Client view -------------------------------------------------------------

function clientLines(flow: Flow, report: QuoteReport, sym: string, contentW: number): void {
  // One rolled-up line for the panel work (no cost breakdown), plus each explicit manual line.
  const panelAmount = report.total - report.manualSubtotal
  lineRow(
    flow,
    'Stained glass panel — materials, design & fabrication',
    formatMoney(panelAmount, sym),
    contentW,
    { bold: true },
  )
  for (const line of report.manualLines) {
    lineRow(flow, line.label, formatMoney(line.amount, sym), contentW)
  }
  flow.advance(2)
}

// --- Internal breakdown ------------------------------------------------------

function breakdown(flow: Flow, report: QuoteReport, sym: string, contentW: number): void {
  sectionHeading(flow, 'Materials')
  const groups: [string, readonly QuoteLine[]][] = [
    ['Glass', report.materials.glass],
    [
      report.technique === 'foil' ? 'Copper foil' : 'Lead came',
      report.materials.lead.length ? report.materials.lead : report.materials.foil,
    ],
    ['Reinforcement', report.materials.reinforcement],
    ['Consumables', report.materials.consumables],
  ]
  for (const [label, lines] of groups) {
    if (lines.length === 0) continue
    subHeading(flow, label)
    for (const line of lines) {
      detailRow(
        flow,
        line.label,
        line.detail,
        formatMoney(line.amount, sym),
        contentW,
        line.unpriced,
      )
    }
  }
  subtotalRow(flow, 'Materials subtotal', formatMoney(report.materials.subtotal, sym), contentW)

  // Labor — the transparent hours breakdown (FR-4).
  sectionHeading(flow, 'Labor')
  note(
    flow,
    `Estimated at ${sym}${round2(report.labor.hourlyRate)}/h. Uncalibrated placeholder model — hours = setup + per-piece (with a complexity term${report.labor.pieceFactor !== 1 ? ' and a foil factor' : ''}) + per-metre of seam.`,
  )
  detailRow(
    flow,
    'Setup & design',
    `${round2(report.labor.setupHours)} h`,
    formatMoney(report.labor.setupCost, sym),
    contentW,
  )
  detailRow(
    flow,
    'Cutting & fitting (per piece)',
    `${round2(report.labor.pieceHours)} h`,
    formatMoney(report.labor.pieceCost, sym),
    contentW,
  )
  detailRow(
    flow,
    `Leading / foiling (${round2(report.labor.seamMetres)} m of seam)`,
    `${round2(report.labor.seamHours)} h`,
    formatMoney(report.labor.seamCost, sym),
    contentW,
  )
  subtotalRow(
    flow,
    `Labor subtotal (${round2(report.labor.hours)} h)`,
    formatMoney(report.labor.cost, sym),
    contentW,
  )

  if (report.manualLines.length > 0) {
    sectionHeading(flow, 'Other line items')
    for (const line of report.manualLines) {
      lineRow(flow, line.label, formatMoney(line.amount, sym), contentW)
    }
    subtotalRow(flow, 'Line items subtotal', formatMoney(report.manualSubtotal, sym), contentW)
  }
}

// --- Totals ------------------------------------------------------------------

function totals(
  flow: Flow,
  report: QuoteReport,
  sym: string,
  contentW: number,
  includeBreakdown: boolean,
): void {
  flow.ensure(LINE * 4)
  flow.advance(2)
  rule(flow, INK, 0.4)
  flow.advance(3)
  if (includeBreakdown) {
    lineRow(flow, 'Subtotal', formatMoney(report.subtotal, sym), contentW)
    lineRow(
      flow,
      `Overhead (${pct(report.overheadPct)})`,
      formatMoney(report.overhead, sym),
      contentW,
    )
    lineRow(flow, `Margin (${pct(report.marginPct)})`, formatMoney(report.margin, sym), contentW)
    flow.advance(1)
    rule(flow)
    flow.advance(2)
  }
  // Grand total — the prominent client figure.
  const y = flow.y
  flow.page.text(vec2(MARGIN, y + 5), 'Total', {
    sizePt: H2,
    color: INK,
    align: 'left',
    bold: true,
  })
  flow.page.text(vec2(MARGIN + contentW, y + 5), formatMoney(report.total, sym), {
    sizePt: H2,
    color: ACCENT,
    align: 'right',
    font: 'mono',
    bold: true,
  })
  flow.advance(LINE + 4)
}

// --- Notes -------------------------------------------------------------------

function notesBlock(flow: Flow, text: string, contentW: number): void {
  flow.advance(2)
  subHeading(flow, 'Notes')
  for (const line of wrap(text, 96)) {
    flow.ensure(LINE)
    flow.page.text(vec2(MARGIN, flow.y + 3), line, { sizePt: SMALL, color: INK, align: 'left' })
    flow.advance(LINE - 1)
  }
  void contentW
}

// --- Shared primitives -------------------------------------------------------

function lineRow(
  flow: Flow,
  label: string,
  value: string,
  contentW: number,
  opts: { bold?: boolean } = {},
): void {
  flow.ensure(LINE)
  const y = flow.y
  flow.page.text(vec2(MARGIN, y + 3), label, {
    sizePt: BODY,
    color: INK,
    align: 'left',
    bold: opts.bold ?? false,
  })
  flow.page.text(vec2(MARGIN + contentW, y + 3), value, {
    sizePt: BODY,
    color: INK,
    align: 'right',
    font: 'mono',
    bold: opts.bold ?? false,
  })
  flow.advance(LINE)
}

function detailRow(
  flow: Flow,
  label: string,
  detail: string,
  value: string,
  contentW: number,
  unpriced = false,
): void {
  flow.ensure(LINE)
  const y = flow.y
  flow.page.text(vec2(MARGIN + 2, y + 3), label, { sizePt: SMALL, color: INK, align: 'left' })
  flow.page.text(vec2(MARGIN + contentW - 30, y + 3), detail, {
    sizePt: SMALL,
    color: MUTED,
    align: 'right',
  })
  flow.page.text(vec2(MARGIN + contentW, y + 3), value, {
    sizePt: SMALL,
    color: unpriced ? MUTED : INK,
    align: 'right',
    font: 'mono',
  })
  flow.advance(LINE - 0.5)
}

function subtotalRow(flow: Flow, label: string, value: string, contentW: number): void {
  flow.ensure(LINE + 1)
  flow.advance(0.5)
  const y = flow.y
  flow.page.text(vec2(MARGIN, y + 3), label, { sizePt: SMALL, color: MUTED, align: 'left' })
  flow.page.text(vec2(MARGIN + contentW, y + 3), value, {
    sizePt: SMALL,
    color: INK,
    align: 'right',
    font: 'mono',
    bold: true,
  })
  flow.advance(LINE + 1)
}

function sectionHeading(flow: Flow, text: string): void {
  flow.ensure(H2 + 4)
  flow.advance(3)
  flow.page.text(vec2(MARGIN, flow.y + 4), text, {
    sizePt: H2,
    color: INK,
    align: 'left',
    bold: true,
  })
  flow.advance(H2 - 4)
  rule(flow, RULE, 0.3)
  flow.advance(2)
}

function subHeading(flow: Flow, text: string): void {
  flow.ensure(LINE + 3)
  flow.advance(1)
  flow.page.text(vec2(MARGIN, flow.y + 3), text.toUpperCase(), {
    sizePt: 6.5,
    color: MUTED,
    align: 'left',
    bold: true,
  })
  flow.advance(LINE - 1)
}

function note(flow: Flow, text: string): void {
  for (const line of wrap(text, 108)) {
    flow.ensure(LINE - 1)
    flow.page.text(vec2(MARGIN, flow.y + 3), line, { sizePt: 6.8, color: MUTED, align: 'left' })
    flow.advance(LINE - 2)
  }
  flow.advance(1)
}

function rule(flow: Flow, color = RULE, widthMm = 0.2): void {
  const stroke: Stroke = { color, widthMm }
  flow.page.line(vec2(MARGIN, flow.y), vec2(flow.widthMm - MARGIN, flow.y), stroke)
}

/** Format money with the currency symbol, two decimals, negatives as `-€20.00`. */
function formatMoney(amount: number, symbol: string): string {
  const abs = Math.abs(amount)
  const body = `${symbol}${abs.toFixed(2)}`
  return amount < 0 ? `-${body}` : body
}

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toString()
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

/** Naive greedy word-wrap for the notes / model description (character budget per line). */
function wrap(text: string, max: number): string[] {
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current.length + word.length + 1 > max) {
      if (current) lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current)
  return lines
}
