import type { BBox, Vec2 } from '@vitrum/geometry'

import type { Orientation, PaperSize } from './units'

/**
 * The backend-neutral description of what to print (F-041). The UI resolves its live document —
 * detected pieces, the lead-line network, numbering, glass, technique cut contours — into this plain
 * data, and {@link buildPrintDocument} turns it (plus {@link PrintOptions}) into a {@link PdfDoc}.
 * Keeping this a pure data seam means the composition/tiling is testable without any Svelte or
 * canvas, and F-042/F-043 can build the same scene for their own outputs.
 *
 * All coordinates are in **world millimetres** (the document's own space, y-down).
 */
export interface PrintScene {
  /** Bounds (mm) of everything to print — usually the panel rectangle unioned with the geometry. */
  readonly contentBounds: BBox
  /** The lead-line network as flattened polylines (arcs/béziers already sampled). */
  readonly network: readonly NetworkLine[]
  /** Technique-derived cut contours as flattened rings (for the "cut contours" content mode). */
  readonly cutLines: readonly (readonly Vec2[])[]
  /** Detected pieces, for fills (render mode) and number placement. */
  readonly pieces: readonly ScenePiece[]
  /** Glass legend rows (code → glass), for the overview page. */
  readonly legend: readonly LegendRow[]
}

/** One flattened lead-line segment. `border` draws heavier; `construction` is normally excluded. */
export interface NetworkLine {
  readonly points: readonly Vec2[]
  readonly role: 'lead' | 'border' | 'construction'
  /** True width of the line in mm (came flange or foil weight); the composer clamps a min. */
  readonly widthMm: number
}

/** One piece for print: its polygon, an optional glass colour (render mode) and its number. */
export interface ScenePiece {
  readonly ring: readonly Vec2[]
  readonly holeRings: readonly (readonly Vec2[])[]
  /** Glass base colour as a CSS hex string, when assigned (render mode fill). */
  readonly fillColor?: string
  /** Effective piece number/label, when numbered. */
  readonly label?: string
  /** Where the label is anchored (pole of inaccessibility). */
  readonly labelAt?: Vec2
  /** Inscribed radius (mm) at the label anchor — sizes the label and picks leader vs. inline. */
  readonly labelRadiusMm?: number
}

/** One legend row: glass code, name, optional maker and colour, and piece count. */
export interface LegendRow {
  readonly code: string
  readonly name: string
  readonly manufacturer?: string
  readonly color?: string
  readonly count: number
}

/** Which derived view is printed. */
export type PrintContent = 'cartoon' | 'cut' | 'render'

/** What optional elements to include on the print (each independently toggleable in the dialog). */
export interface PrintInclude {
  readonly numbers: boolean
  readonly glassCodes: boolean
  readonly alignmentMarks: boolean
  readonly pageLabels: boolean
  readonly calibrationRuler: boolean
  readonly overviewMap: boolean
}

export interface PrintOptions {
  readonly paper: PaperSize
  readonly orientation: Orientation
  readonly marginMm: number
  readonly overlapMm: number
  readonly content: PrintContent
  readonly include: PrintInclude
  /** Document title (panel name), shown on the overview page and in PDF metadata. */
  readonly projectName: string
}

/** The default overlap band width in mm (Mathieu, 2026-07-20 review: 15 mm). */
export const DEFAULT_OVERLAP_MM = 15

/** The default sheet margin in mm. */
export const DEFAULT_MARGIN_MM = 10

/** The length in mm of the printed calibration ruler (FR-1 physical check). */
export const CALIBRATION_LENGTH_MM = 100

/** Every optional element on. */
export const DEFAULT_INCLUDE: PrintInclude = {
  numbers: true,
  glassCodes: true,
  alignmentMarks: true,
  pageLabels: true,
  calibrationRuler: true,
  overviewMap: true,
}
