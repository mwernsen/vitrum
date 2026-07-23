import type { Vec2 } from '@vitrum/geometry'

/**
 * The document-drawing abstraction (F-041). A {@link PdfDoc} is a backend-independent, pure-data
 * description of pages made of millimetre-space draw operations. F-041 builds one for a tiled 1:1
 * print; F-042 (cutting list / BOM) and F-043 (export) reuse the very same model for their PDFs, so
 * the pdf-lib backend and the unit handling are written and tested once. Keeping the model as plain
 * data is also what lets the tiling and composition logic be unit-tested by walking the op tree,
 * without parsing a real PDF (the F-041 acceptance approach).
 *
 * Coordinate convention: page space is millimetres with the origin at the **top-left** of the sheet
 * and **y increasing downward** — the same convention as the document/canvas world, so translating
 * world geometry onto a page is a plain offset with no axis flip. The backend performs the single
 * flip to PDF's bottom-left, y-up space.
 */

/** A stroke style. `widthMm` is the line weight in mm; `dashMm` (if set) is an on/off pattern in mm. */
export interface Stroke {
  readonly color: string
  readonly widthMm: number
  readonly dashMm?: readonly number[]
}

/** A fill style. `evenOdd` selects the even-odd rule so holes punch through (default nonzero). */
export interface Fill {
  readonly color: string
  readonly evenOdd?: boolean
}

/** Horizontal text alignment relative to the anchor point. */
export type TextAlign = 'left' | 'center' | 'right'

/** Vertical placement of the anchor relative to the text: its baseline, visual middle, or top. */
export type TextBaseline = 'alphabetic' | 'middle' | 'top'

/** Which font family a text op uses. `mono` is for numbers/codes, matching the on-screen mono. */
export type FontFamily = 'sans' | 'mono'

/** An axis-aligned rectangle in page millimetre-space. */
export interface RectMm {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** One drawing operation in page millimetre-space. */
export type DrawOp =
  | {
      readonly kind: 'polyline'
      readonly points: readonly Vec2[]
      readonly stroke: Stroke
      readonly close?: boolean
    }
  | {
      readonly kind: 'polygon'
      readonly ring: readonly Vec2[]
      readonly holes?: readonly (readonly Vec2[])[]
      readonly fill?: Fill
      readonly stroke?: Stroke
    }
  | { readonly kind: 'rect'; readonly rect: RectMm; readonly fill?: Fill; readonly stroke?: Stroke }
  | {
      readonly kind: 'circle'
      readonly center: Vec2
      readonly radiusMm: number
      readonly fill?: Fill
      readonly stroke?: Stroke
    }
  | {
      readonly kind: 'text'
      readonly at: Vec2
      readonly text: string
      /** Font size in **points** — text is naturally specified in pt, geometry in mm. */
      readonly sizePt: number
      readonly color: string
      readonly align?: TextAlign
      readonly baseline?: TextBaseline
      readonly font?: FontFamily
      readonly bold?: boolean
    }
  /**
   * A raster image placed in a page rectangle (top-left origin, y-down mm). Used by the F-056 quote
   * PDF for the optional rendered panel snapshot. `data` is the encoded image bytes; the backend
   * embeds them once and draws them fitted to `rect` (the caller sizes `rect` to the image aspect).
   */
  | {
      readonly kind: 'image'
      readonly rect: RectMm
      readonly data: Uint8Array
      readonly format: 'png' | 'jpg'
    }
  /** A nested group; `clip` (if set) restricts its children to that rectangle. */
  | { readonly kind: 'group'; readonly ops: readonly DrawOp[]; readonly clip?: RectMm }

/** One page: its physical size in mm and the ops that draw it (top-left origin, y-down). */
export interface PageContent {
  readonly widthMm: number
  readonly heightMm: number
  /** A short human label used for diagnostics and test assertions (e.g. `A1`, `overview`). */
  readonly label: string
  readonly ops: readonly DrawOp[]
}

/** A full multi-page document, ready for a backend to render. */
export interface PdfDoc {
  /** Document title, embedded in PDF metadata. */
  readonly title: string
  readonly pages: readonly PageContent[]
}

/**
 * A tiny mutable builder that accumulates {@link DrawOp}s for one page, so composition code reads as
 * a sequence of `page.line(...)`, `page.text(...)` calls rather than hand-assembling the union. It is
 * pure (no rendering) — `.build(label)` freezes the ops into a {@link PageContent}.
 */
export class PageBuilder {
  readonly #ops: DrawOp[] = []

  constructor(
    readonly widthMm: number,
    readonly heightMm: number,
  ) {}

  push(op: DrawOp): this {
    this.#ops.push(op)
    return this
  }

  line(a: Vec2, b: Vec2, stroke: Stroke): this {
    return this.push({ kind: 'polyline', points: [a, b], stroke })
  }

  polyline(points: readonly Vec2[], stroke: Stroke, close = false): this {
    return this.push({ kind: 'polyline', points, stroke, close })
  }

  polygon(
    ring: readonly Vec2[],
    opts: { holes?: readonly (readonly Vec2[])[]; fill?: Fill; stroke?: Stroke } = {},
  ): this {
    return this.push({
      kind: 'polygon',
      ring,
      holes: opts.holes,
      fill: opts.fill,
      stroke: opts.stroke,
    })
  }

  rect(rect: RectMm, opts: { fill?: Fill; stroke?: Stroke } = {}): this {
    return this.push({ kind: 'rect', rect, fill: opts.fill, stroke: opts.stroke })
  }

  circle(center: Vec2, radiusMm: number, opts: { fill?: Fill; stroke?: Stroke } = {}): this {
    return this.push({ kind: 'circle', center, radiusMm, fill: opts.fill, stroke: opts.stroke })
  }

  image(rect: RectMm, data: Uint8Array, format: 'png' | 'jpg' = 'png'): this {
    return this.push({ kind: 'image', rect, data, format })
  }

  text(
    at: Vec2,
    text: string,
    opts: {
      sizePt: number
      color: string
      align?: TextAlign
      baseline?: TextBaseline
      font?: FontFamily
      bold?: boolean
    },
  ): this {
    return this.push({ kind: 'text', at, text, ...opts })
  }

  /** Add a clipped group; `draw` receives a fresh builder whose ops become the group's children. */
  group(clip: RectMm | undefined, draw: (g: PageBuilder) => void): this {
    const inner = new PageBuilder(this.widthMm, this.heightMm)
    draw(inner)
    return this.push({ kind: 'group', clip, ops: inner.ops })
  }

  get ops(): readonly DrawOp[] {
    return this.#ops
  }

  build(label: string): PageContent {
    return { widthMm: this.widthMm, heightMm: this.heightMm, label, ops: [...this.#ops] }
  }
}

/** Recursively visit every op in a page, descending into groups. Useful for tests and inspection. */
export function forEachOp(ops: readonly DrawOp[], visit: (op: DrawOp) => void): void {
  for (const op of ops) {
    visit(op)
    if (op.kind === 'group') forEachOp(op.ops, visit)
  }
}
