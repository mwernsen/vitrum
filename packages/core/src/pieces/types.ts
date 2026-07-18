import type { Arc, BBox, CubicBezier, Line, Vec2 } from '@vitrum/geometry'

/**
 * Piece detection (F-020): deriving the glass **pieces** (closed regions) from the
 * lead-line network, the way EDA derives nets from a schematic. Everything here is pure
 * data plus free functions — no DOM, no Svelte, no `@vitrum/model` dependency. Detection
 * accepts a structural view of the network ({@link PieceSegment}) that `@vitrum/model`'s
 * `Segment` satisfies verbatim, so `packages/core` stays model-independent (the same
 * pattern the drawing tools use with `DrawGeometry`/`DrawRole`).
 *
 * Pieces are always *recomputed*, never hand-maintained: they carry stable ids so that
 * downstream glass assignment (F-023) and numbering (F-040) survive edits that don't
 * meaningfully change a region (FR-3).
 */

/** A stable id for a detected piece. Survives edits via generational matching (FR-3). */
export type PieceId = string

/** The geometry a network segment can carry (mirrors `@vitrum/model`'s `SegmentGeometry`). */
export type PieceGeometry = Line | Arc | CubicBezier

/** The role a segment carries (mirrors `@vitrum/model`'s `SegmentRole`). */
export type PieceSegmentRole = 'lead' | 'construction' | 'border'

/**
 * One edge of the lead-line network as detection sees it. Structurally a subset of
 * `@vitrum/model`'s `Segment`, so callers pass model segments directly. `endpoints` are the
 * `[start, end]` node ids the geometry welds to — detection uses them only to tell welded
 * junctions from near-misses; graph topology itself is derived from geometry positions.
 */
export interface PieceSegment {
  readonly id: string
  readonly geometry: PieceGeometry
  readonly role: PieceSegmentRole
  readonly endpoints: readonly [string, string]
}

/**
 * One span of a piece's boundary: a sub-curve of a source segment, walked in boundary
 * order. `tStart`/`tEnd` are parameters on the source segment's geometry; `tStart > tEnd`
 * means the boundary walks the source curve backwards. Keeping the reference back to the
 * source segment (rather than only a flattened polyline) is what lets F-021 offset the
 * true cut contour and F-023 render exact curved glass edges.
 */
export interface BoundarySpan {
  readonly segmentId: string
  readonly tStart: number
  readonly tEnd: number
}

/**
 * A detected glass piece. `boundary` is the outer ring as ordered curve spans; `holes`
 * are inner rings (a piece enclosing a disconnected island of lead). `ring`/`holeRings`
 * are the flattened polygons used for hit-testing, overlay fill and identity matching.
 * `area` already has holes subtracted; `perimeter` sums every boundary span (outer + holes).
 */
export interface Piece {
  readonly id: PieceId
  readonly boundary: readonly BoundarySpan[]
  readonly holes: readonly (readonly BoundarySpan[])[]
  readonly ring: readonly Vec2[]
  readonly holeRings: readonly (readonly Vec2[])[]
  readonly area: number
  readonly perimeter: number
  readonly centroid: Vec2
  readonly bbox: BBox
}

/** The class of network imperfection a diagnostic reports (doubles as F-030's ERC input). */
export type DiagnosticKind = 'dangling-end' | 'near-miss' | 'duplicate-segment'

/**
 * A network imperfection found during detection. `at` is a representative location for the
 * overlay marker; `segmentIds` are the segment(s) involved; `distance` (near-miss only) is
 * the measured gap in mm. Diagnostics are data only — F-020 never mutates the document to
 * fix them (Mathieu, 2026-07-18: "report, never mutate").
 */
export interface Diagnostic {
  readonly kind: DiagnosticKind
  readonly at: Vec2
  readonly segmentIds: readonly string[]
  readonly distance?: number
  readonly message: string
}

/** The full result of a detection pass. */
export interface DetectionResult {
  readonly pieces: readonly Piece[]
  readonly diagnostics: readonly Diagnostic[]
}

/** Tuning knobs for detection. Every field has a documented default (see `DETECT_DEFAULTS`). */
export interface DetectOptions {
  /**
   * Vertices within this distance (mm) collapse to one graph vertex. This is the internal
   * face-tracing epsilon only — it absorbs floating-point noise (and truly coincident
   * endpoints) but is far below the near-miss band, so real gaps stay distinct and are
   * reported rather than silently bridged. Default 0.01 mm.
   */
  readonly weldTolerance?: number
  /**
   * Endpoints closer than this (mm) but not welded are reported as near-miss junctions.
   * Default 0.5 mm.
   */
  readonly nearMissTolerance?: number
  /** Max deviation (mm) when flattening curved boundary spans to polygons. Default 0.05 mm. */
  readonly flattenTolerance?: number
  /** Previous generation, for stable-id matching (FR-3). Omit for a cold detection. */
  readonly previous?: readonly Piece[]
}

export const DETECT_DEFAULTS = {
  weldTolerance: 0.01,
  nearMissTolerance: 0.5,
  flattenTolerance: 0.05,
} as const
