/**
 * Physical-unit conversions for paper output (F-041). Every scale bug in a 1:1 print lives
 * in the millimetre ↔ PDF-point conversion, so it is centralised here (with tests) and used by
 * every other module in this package — never re-derived inline. PDF's native unit is the
 * "big point": exactly 1/72 inch, and one inch is exactly 25.4 mm.
 */

/** Millimetres per inch (exact). */
export const MM_PER_INCH = 25.4

/** PDF points per inch (exact — the PDF "big point"). */
export const PT_PER_INCH = 72

/** PDF points per millimetre. `1 mm = 72 / 25.4 pt ≈ 2.834645669…` */
export const PT_PER_MM = PT_PER_INCH / MM_PER_INCH

/** Millimetres per PDF point. */
export const MM_PER_PT = MM_PER_INCH / PT_PER_INCH

/** Convert a length in millimetres to PDF points. */
export function mmToPt(mm: number): number {
  return mm * PT_PER_MM
}

/** Convert a length in PDF points to millimetres. */
export function ptToMm(pt: number): number {
  return pt * MM_PER_PT
}

/** A named paper size, in millimetres (portrait: height ≥ width). */
export interface PaperSize {
  readonly id: string
  readonly label: string
  readonly widthMm: number
  readonly heightMm: number
}

/**
 * The paper sizes the print dialog offers out of the box (F-041 scope). Dimensions are the ISO
 * 216 / ANSI definitions in millimetres, portrait orientation; the dialog derives landscape by
 * swapping the two. Custom sizes are supplied by the user and are not in this table.
 */
export const PAPER_SIZES: readonly PaperSize[] = [
  { id: 'a4', label: 'A4', widthMm: 210, heightMm: 297 },
  { id: 'a3', label: 'A3', widthMm: 297, heightMm: 420 },
  { id: 'letter', label: 'Letter', widthMm: 215.9, heightMm: 279.4 },
]

/** Look up a paper size by id, or `undefined` for a custom/unknown id. */
export function paperSize(id: string): PaperSize | undefined {
  return PAPER_SIZES.find((p) => p.id === id)
}

export type Orientation = 'portrait' | 'landscape'

/** The width/height of a paper size in the given orientation, in millimetres. */
export function orientedSize(
  paper: PaperSize,
  orientation: Orientation,
): {
  readonly widthMm: number
  readonly heightMm: number
} {
  const portrait = { widthMm: paper.widthMm, heightMm: paper.heightMm }
  if (orientation === 'portrait') return portrait
  return { widthMm: paper.heightMm, heightMm: paper.widthMm }
}
