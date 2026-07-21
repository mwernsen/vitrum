import type { Arc, BBox, CubicBezier, Line, Vec2 } from '@vitrum/geometry'

import type { LegendRow } from './scene'
import type { Orientation, PaperSize } from './units'

/**
 * The backend-neutral description of what to export (F-043). Unlike {@link PrintScene}, which carries
 * pre-flattened polylines for a raster-faithful 1:1 print, the export scene keeps the **true segment
 * geometry** (lines, arcs, cubics) so SVG linework can round-trip losslessly with SVG import (F-050)
 * and DXF can emit arcs as arcs (FR-3). It also carries each piece's technique-inset **cut contour**
 * (F-021) for the cut-template flavour, and reinforcement bars (F-032) for the DXF `REBAR` layer.
 *
 * All coordinates are in **world millimetres** (the document's own space, y-down). SVG keeps this
 * space directly (SVG is y-down too); DXF flips to its y-up convention in the backend.
 */
export interface ExportScene {
  /** Bounds (mm) of everything to export — the panel rectangle unioned with the geometry. */
  readonly contentBounds: BBox
  /** The lead-line network as true geometry (not flattened), each tagged with its role. */
  readonly segments: readonly ExportSegment[]
  /** Detected pieces with their fills, numbers and technique cut contours. */
  readonly pieces: readonly ExportPiece[]
  /** Reinforcement bars (F-032) — the DXF `REBAR` layer. */
  readonly reinforcements: readonly ExportBar[]
  /** Glass legend rows (code → glass), for the coloured render / PDF legend. */
  readonly legend: readonly LegendRow[]
}

/** One lead-line segment: its exact geometry, role and true line width (mm). */
export interface ExportSegment {
  /** Stable id (segment id) — used only to order output deterministically (FR-4). */
  readonly id: string
  readonly geometry: Line | Arc | CubicBezier
  readonly role: 'lead' | 'border' | 'construction'
  /** True width of the line in mm (came flange or foil weight). */
  readonly widthMm: number
}

/** One piece for export: its polygon, technique cut contour, optional glass colour and number. */
export interface ExportPiece {
  /** Stable content-id key — used only to order output deterministically (FR-4). */
  readonly key: string
  readonly ring: readonly Vec2[]
  readonly holeRings: readonly (readonly Vec2[])[]
  /**
   * The technique-inset cut contour (F-021), where the glass is actually cut. Absent when the piece
   * is too small to inset (degenerate — flagged, never dropped): callers fall back to {@link ring}.
   */
  readonly cutRing?: readonly Vec2[]
  readonly cutHoleRings?: readonly (readonly Vec2[])[]
  /** Glass base colour as a CSS hex string, when assigned (render fill). */
  readonly fillColor?: string
  /** Effective piece number/label, when numbered. */
  readonly label?: string
  /** Where the label is anchored (pole of inaccessibility). */
  readonly labelAt?: Vec2
}

/** One reinforcement bar (F-032): a straight centreline with a width. */
export interface ExportBar {
  readonly a: Vec2
  readonly b: Vec2
  readonly widthMm: number
}

// --- Options ----------------------------------------------------------------

/** Which container format an export targets. */
export type ExportFormat = 'svg' | 'pdf' | 'dxf'

/**
 * The three SVG flavours (F-043 scope):
 * - `linework`: drawn lead lines as paths, true geometry (round-trip target for F-050).
 * - `cut`: each piece's cut contour as one closed path, numbered (the Cricut/Silhouette use case).
 * - `render`: filled pieces + lead strokes for web/portfolio use.
 */
export type SvgFlavor = 'linework' | 'cut' | 'render'

/** Cut-template layout: contours in their design position, or spread on a numbered grid. */
export type CutLayout = 'in-place' | 'grid'

/** PDF scale: true 1:1 physical size (large custom sheet), or scaled to fit a named page. */
export type PdfScaleMode = 'actual' | 'fit'

/** PDF look: coloured render (glass fills) or monochrome cartoon (line work + numbers). */
export type PdfLook = 'render' | 'cartoon'

/** Options for the SVG builder. */
export interface SvgOptions {
  readonly flavor: SvgFlavor
  /** Cut-template layout (only used for the `cut` flavour). */
  readonly cutLayout: CutLayout
  /** Include piece numbers (cut / render flavours). */
  readonly includeNumbers: boolean
  /** Panel name, embedded as the SVG `<title>`. */
  readonly projectName: string
}

/** Options for the single-sheet PDF export builder. */
export interface ExportPdfOptions {
  readonly scaleMode: PdfScaleMode
  readonly look: PdfLook
  readonly includeNumbers: boolean
  /** Target page (used when `scaleMode === 'fit'`). */
  readonly paper: PaperSize
  readonly orientation: Orientation
  readonly marginMm: number
  readonly projectName: string
}

/** Options for the DXF builder. */
export interface DxfOptions {
  readonly projectName: string
  /** Include the technique cut contours on the `CUT` layer (default true). */
  readonly includeCut: boolean
}

/** Default single-sheet PDF margin (mm). */
export const DEFAULT_EXPORT_MARGIN_MM = 10

/**
 * Technique-aware export defaults (F-043). The cut inset is technique-derived (F-021), so a foil
 * design — which is built from many small pieces — defaults to the spread grid so the tiny contours
 * are separable; a leaded design keeps them in place. Everything else is a neutral starting point the
 * dialog lets the user change.
 */
export function defaultCutLayout(technique: 'lead' | 'foil'): CutLayout {
  return technique === 'foil' ? 'grid' : 'in-place'
}
