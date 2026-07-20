import type { CutContour, LabelPlacement, Piece } from '@vitrum/core'
import type { BBox, Vec2 } from '@vitrum/geometry'
import type { Glass, GlassId, Segment } from '@vitrum/model'
import type { LegendRow, NetworkLine, PrintScene, ScenePiece } from '@vitrum/paper'

import { segmentToWorldPoints } from '../canvas/scene'

/**
 * Resolve the live document's derived state into a backend-neutral {@link PrintScene} for
 * `@vitrum/paper` (F-041). This is the seam between the reactive UI (controllers, runes) and the pure
 * output pipeline: everything the print needs is snapshotted here as plain world-millimetre data, so
 * the composition/tiling/PDF code stays framework-free and testable. F-042/F-043 build the same
 * scene from the same inputs.
 */
export interface PrintSceneInput {
  /** World-space bounds (mm) to print — the panel rectangle unioned with the geometry. */
  readonly contentBounds: BBox
  /** Output-network segments (construction guides already excluded by the caller if desired). */
  readonly segments: readonly Segment[]
  /** True line width (mm) for a segment — came flange (F-021) or a thin foil weight. */
  readonly leadWidthMm: (segment: Segment) => number
  readonly pieces: readonly Piece[]
  /** Technique-derived cut contours (F-021) for the "cut contours" content mode. */
  readonly cutContours: readonly CutContour[]
  /** Effective glass for a piece (direct or inherited), or undefined when unassigned. */
  readonly glassFor: (piece: Piece) => GlassId | undefined
  readonly glasses: Readonly<Record<GlassId, Glass>>
  /** Effective number/label for a piece, or undefined when unnumbered. */
  readonly labelFor: (piece: Piece) => string | undefined
  /** Label anchor + inscribed radius for a piece (pole of inaccessibility, F-040). */
  readonly placementFor: (piece: Piece) => LabelPlacement | undefined
  /** Legend rows (code → glass) already assembled by the shell (FR-4 parity with the on-screen one). */
  readonly legend: readonly LegendRow[]
}

export function buildPrintScene(input: PrintSceneInput): PrintScene {
  const network: NetworkLine[] = input.segments.map((seg) => ({
    points: segmentToWorldPoints(seg.geometry),
    role: seg.role,
    widthMm: input.leadWidthMm(seg),
  }))

  const cutLines: Vec2[][] = []
  for (const cut of input.cutContours) {
    if (cut.ring.length >= 2) cutLines.push([...cut.ring])
    for (const hole of cut.holeRings) if (hole.length >= 2) cutLines.push([...hole])
  }

  const pieces: ScenePiece[] = input.pieces.map((piece) => {
    const glassId = input.glassFor(piece)
    const glass = glassId ? input.glasses[glassId] : undefined
    const placement = input.placementFor(piece)
    return {
      ring: piece.ring,
      holeRings: piece.holeRings,
      fillColor: glass?.color,
      label: input.labelFor(piece),
      labelAt: placement?.at,
      labelRadiusMm: placement?.radius,
    }
  })

  return { contentBounds: input.contentBounds, network, cutLines, pieces, legend: input.legend }
}
