/**
 * `@vitrum/paper` — the document-drawing + PDF abstraction (F-041). A backend-neutral, millimetre-
 * space page model ({@link PdfDoc}/{@link DrawOp}) plus the tiling, composition and pdf-lib rendering
 * for 1:1 tiled printing. Pure TypeScript: no DOM, no Svelte, no Electron, so it is unit-testable and
 * reusable by the cutting list/BOM (F-042) and export (F-043) features. The UI builds a
 * {@link PrintScene} from the live document and hands the rendered bytes to its host.
 */

// Units (mm ↔ pt), paper sizes
export {
  MM_PER_INCH,
  MM_PER_PT,
  PAPER_SIZES,
  PT_PER_INCH,
  PT_PER_MM,
  mmToPt,
  orientedSize,
  paperSize,
  ptToMm,
  type Orientation,
  type PaperSize,
} from './units'

// Page-drawing abstraction
export {
  PageBuilder,
  forEachOp,
  type DrawOp,
  type Fill,
  type FontFamily,
  type PageContent,
  type PdfDoc,
  type RectMm,
  type Stroke,
  type TextAlign,
  type TextBaseline,
} from './page'

// Rectangle clipping
export { clipPolygon, clipPolyline } from './clip'

// Tiling grid
export {
  columnLabel,
  computeTiling,
  internalSeams,
  tileLabel,
  type Seam,
  type Tile,
  type Tiling,
  type TilingOptions,
} from './tiling'

// Print scene + options
export {
  CALIBRATION_LENGTH_MM,
  DEFAULT_INCLUDE,
  DEFAULT_MARGIN_MM,
  DEFAULT_OVERLAP_MM,
  type LegendRow,
  type NetworkLine,
  type PrintContent,
  type PrintInclude,
  type PrintOptions,
  type PrintScene,
  type ScenePiece,
} from './scene'

// Composition + rendering
export { buildPrintDocument } from './compose'
export { renderPdf } from './pdf'

// Cutting list / BOM (F-042)
export { buildBomDocument, type BomDocOptions } from './bom'
export { bomToCsv } from './bomCsv'
