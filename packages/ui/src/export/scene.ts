import type { CutContour, LabelPlacement, Piece } from '@vitrum/core'
import type { BBox } from '@vitrum/geometry'
import type { Glass, GlassId, ReinforcementBar, Segment } from '@vitrum/model'
import type { ExportBar, ExportPiece, ExportScene, ExportSegment, LegendRow } from '@vitrum/paper'

/**
 * Resolve the live document's derived state into a backend-neutral {@link ExportScene} for
 * `@vitrum/paper` (F-043), mirroring `buildPrintScene` (F-041). The difference is fidelity: this
 * carries the **true segment geometry** (not flattened) so SVG linework round-trips with F-050 and
 * DXF keeps arcs as arcs, plus each piece's technique cut contour and the reinforcement bars.
 */
export interface ExportSceneInput {
  readonly contentBounds: BBox
  /** Output-network segments (construction guides filtered in/out by the caller). */
  readonly segments: readonly Segment[]
  /** True line width (mm) for a segment — came flange (F-021) or foil weight. */
  readonly leadWidthMm: (segment: Segment) => number
  readonly pieces: readonly Piece[]
  /** Stable content-id key for a piece (used for deterministic output ordering). */
  readonly pieceKeyOf: (piece: Piece) => string
  /** Technique-derived cut contours (F-021), keyed internally by their `pieceId`. */
  readonly cutContours: readonly CutContour[]
  readonly glassFor: (piece: Piece) => GlassId | undefined
  readonly glasses: Readonly<Record<GlassId, Glass>>
  readonly labelFor: (piece: Piece) => string | undefined
  readonly placementFor: (piece: Piece) => LabelPlacement | undefined
  readonly reinforcements: readonly ReinforcementBar[]
  readonly legend: readonly LegendRow[]
}

export function buildExportScene(input: ExportSceneInput): ExportScene {
  const segments: ExportSegment[] = input.segments.map((seg) => ({
    id: seg.id,
    geometry: seg.geometry,
    role: seg.role,
    widthMm: input.leadWidthMm(seg),
  }))

  const cutByPiece = new Map<string, CutContour>()
  for (const cut of input.cutContours) cutByPiece.set(cut.pieceId, cut)

  const pieces: ExportPiece[] = input.pieces.map((piece) => {
    const glassId = input.glassFor(piece)
    const glass = glassId ? input.glasses[glassId] : undefined
    const placement = input.placementFor(piece)
    const cut = cutByPiece.get(piece.id)
    // A degenerate contour (piece too small to inset) is skipped so callers fall back to the ring.
    const useCut = cut && !cut.degenerate && cut.ring.length >= 3
    return {
      key: input.pieceKeyOf(piece),
      ring: piece.ring,
      holeRings: piece.holeRings,
      cutRing: useCut ? cut!.ring : undefined,
      cutHoleRings: useCut ? cut!.holeRings : undefined,
      fillColor: glass?.color,
      label: input.labelFor(piece),
      labelAt: placement?.at,
    }
  })

  const reinforcements: ExportBar[] = input.reinforcements.map((bar) => ({
    a: bar.a,
    b: bar.b,
    widthMm: bar.widthMm,
  }))

  return {
    contentBounds: input.contentBounds,
    segments,
    pieces,
    reinforcements,
    legend: input.legend,
  }
}
