import type { BBox } from '@vitrum/geometry'

import type { RectMm } from './page'

/**
 * The page-grid computation for tiled 1:1 printing (F-041). A panel larger than one sheet is
 * covered by a grid of tiles that overlap by a fixed band so the printed pages tape together. This
 * module is pure grid arithmetic in millimetres — no drawing — so it is exhaustively unit-testable
 * (the F-041 automated-acceptance approach: assert the grid and the mapped coordinates on plain
 * data, never by parsing a PDF).
 */

export interface TilingOptions {
  /** World-space bounds (mm) of everything that must be printed. */
  readonly contentBounds: BBox
  /** Sheet size in the chosen orientation (mm). */
  readonly pageWidthMm: number
  readonly pageHeightMm: number
  /** Uniform sheet margin (mm); crop marks, page label and the calibration ruler live here. */
  readonly marginMm: number
  /** Overlap band width (mm) shared between adjacent tiles (default 15 mm; FR-2). */
  readonly overlapMm: number
}

/** One tile in the page grid. */
export interface Tile {
  /** 0-based grid position. */
  readonly col: number
  readonly row: number
  /** Page coordinate label: column letter(s) + 1-based row number, e.g. `A1`, `B3`. */
  readonly label: string
  /**
   * The world-space rectangle (mm, top-left origin, y-down) this tile's printable area maps from.
   * Adjacent tiles' world rects overlap by `overlapMm`; the last row/column may extend past the
   * panel (that part prints blank).
   */
  readonly worldRect: RectMm
  /** The printable rectangle on the sheet (page mm-space) the world rect maps onto. */
  readonly printable: RectMm
}

export interface Tiling {
  readonly cols: number
  readonly rows: number
  readonly tiles: readonly Tile[]
  /** Printable area per sheet (mm) — the imageable region inside the margins. */
  readonly contentWidthMm: number
  readonly contentHeightMm: number
  /** World distance (mm) between adjacent tile origins (= content size − overlap). */
  readonly stepXMm: number
  readonly stepYMm: number
  readonly overlapMm: number
  readonly marginMm: number
  readonly pageWidthMm: number
  readonly pageHeightMm: number
  readonly contentBounds: BBox
}

/** Column label for a 0-based index: `A…Z, AA, AB…` (spreadsheet style). */
export function columnLabel(index: number): string {
  let n = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

/** A tile's page label from its grid position: column letter(s) + 1-based row. */
export function tileLabel(col: number, row: number): string {
  return `${columnLabel(col)}${row + 1}`
}

/**
 * Compute the tile grid over the content bounds. Guards degenerate inputs: a printable area of zero
 * (margins swallow the sheet) throws; an overlap ≥ the printable dimension is clamped so the step
 * stays positive and the grid still terminates.
 */
export function computeTiling(options: TilingOptions): Tiling {
  const { contentBounds, pageWidthMm, pageHeightMm, marginMm } = options

  const contentWidthMm = pageWidthMm - 2 * marginMm
  const contentHeightMm = pageHeightMm - 2 * marginMm
  if (contentWidthMm <= 0 || contentHeightMm <= 0) {
    throw new Error('Margins leave no printable area on the sheet.')
  }

  // Keep at least a sliver of forward progress per tile even if the user asks for a huge overlap.
  const overlapMm = Math.max(
    0,
    Math.min(options.overlapMm, contentWidthMm - 1, contentHeightMm - 1),
  )
  const stepXMm = contentWidthMm - overlapMm
  const stepYMm = contentHeightMm - overlapMm

  const panelWidthMm = Math.max(0, contentBounds.max.x - contentBounds.min.x)
  const panelHeightMm = Math.max(0, contentBounds.max.y - contentBounds.min.y)

  const cols = tileCount(panelWidthMm, contentWidthMm, stepXMm)
  const rows = tileCount(panelHeightMm, contentHeightMm, stepYMm)

  const tiles: Tile[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({
        col,
        row,
        label: tileLabel(col, row),
        worldRect: {
          x: contentBounds.min.x + col * stepXMm,
          y: contentBounds.min.y + row * stepYMm,
          w: contentWidthMm,
          h: contentHeightMm,
        },
        printable: { x: marginMm, y: marginMm, w: contentWidthMm, h: contentHeightMm },
      })
    }
  }

  return {
    cols,
    rows,
    tiles,
    contentWidthMm,
    contentHeightMm,
    stepXMm,
    stepYMm,
    overlapMm,
    marginMm,
    pageWidthMm,
    pageHeightMm,
    contentBounds,
  }
}

/**
 * Number of tiles needed to cover `span` with tiles of `size` advancing by `step` each. The last
 * tile must reach the far edge: `(n − 1)·step + size ≥ span`, so `n = ⌈(span − size) / step⌉ + 1`
 * (one tile whenever the span already fits a single sheet).
 */
function tileCount(span: number, size: number, step: number): number {
  if (span <= size) return 1
  // Guard the float boundary so an exact fit does not round up to a spurious extra tile.
  return Math.ceil((span - size) / step - 1e-9) + 1
}

/** A shared seam between two adjacent tiles, in world millimetre-space (for registration marks). */
export interface Seam {
  readonly orientation: 'vertical' | 'horizontal'
  /** The world coordinate of the overlap band's centre (x for vertical seams, y for horizontal). */
  readonly centreMm: number
}

/**
 * Enumerate the internal seams of a tiling: the vertical band centres between each pair of
 * horizontally-adjacent columns and the horizontal band centres between vertically-adjacent rows.
 * A registration crosshair drawn at a seam centre lands on **both** neighbouring sheets (their world
 * rects both contain the band), so when the overlap bands are taped together the marks coincide —
 * and any scaling/offset error makes them visibly fail to line up (FR-2).
 */
export function internalSeams(tiling: Tiling): Seam[] {
  const seams: Seam[] = []
  const { contentBounds, stepXMm, stepYMm, contentWidthMm, contentHeightMm, cols, rows } = tiling
  for (let col = 0; col < cols - 1; col++) {
    // Overlap band shared by column col (right part) and col+1 (left part).
    const bandStart = contentBounds.min.x + (col + 1) * stepXMm
    const bandEnd = contentBounds.min.x + col * stepXMm + contentWidthMm
    seams.push({ orientation: 'vertical', centreMm: (bandStart + bandEnd) / 2 })
  }
  for (let row = 0; row < rows - 1; row++) {
    const bandStart = contentBounds.min.y + (row + 1) * stepYMm
    const bandEnd = contentBounds.min.y + row * stepYMm + contentHeightMm
    seams.push({ orientation: 'horizontal', centreMm: (bandStart + bandEnd) / 2 })
  }
  return seams
}
