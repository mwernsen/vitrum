import {
  edgeAllowanceMm,
  pieceKey,
  type CutContour,
  type Piece,
  type PieceSegment,
  type TechniqueKind,
} from '@vitrum/core'
import { bboxHeight, bboxWidth, inscribedCircle, type Vec2 } from '@vitrum/geometry'
import type { Project } from '@vitrum/model'

import { resolveThreshold } from '../thresholds'
import type { DrcInput, RawViolation, Rule, ThresholdSpec } from '../types'

import { concaveCurvatureHits, cornersOf } from './pieceGeometry'

/**
 * The cuttability rule pack (F-031): can each piece physically be cut from sheet glass by
 * score-and-break? Six rules, all reading F-021's technique-inset cut contours (size, degeneracy)
 * or the pieces' true boundary curves (curvature, corner angles, FR-3). Thresholds are craft numbers
 * that differ by technique — copper foil permits finer, smaller pieces than lead came — and every one
 * is declared as a {@link ThresholdSpec} so a workshop can retune it and the settings UI can explain
 * it. Defaults are the spec's synthesis of craft guidance, sanity-checked with Mathieu (2026-07-19).
 *
 * Messages teach: the row states the measured value and the limit; the rule's `explain` says why the
 * glass behaves this way and how to fix it. Two rules grade themselves (a warning that escalates to
 * an error past a hard limit) via the per-violation `severity` seam.
 */

const DEG = 180 / Math.PI

/** Format a millimetre measurement for a message (one decimal, no trailing unit noise). */
function mm(value: number): string {
  return value.toFixed(1)
}

/** Build the segment lookup rules need for boundary geometry (model `Segment` ⊇ `PieceSegment`). */
function segmentsById(project: Project): Map<string, PieceSegment> {
  return new Map(Object.values(project.segments).map((s) => [s.id, s]))
}

/** Index pieces by their (volatile) detection id, to recover the stable content id from a contour. */
function pieceById(input: DrcInput): Map<string, Piece> {
  return new Map(input.pieces.map((p) => [p.id, p]))
}

/** A threshold whose default is the same for lead and foil (curvature/angle limits, in v1). */
function fixed(
  key: string,
  label: string,
  unit: string,
  value: number,
  rationale: string,
): ThresholdSpec {
  return { key, label, unit, rationale, defaultFor: () => value }
}

/** A threshold whose default differs by technique (foil permits finer work than lead). */
function perTechnique(
  key: string,
  label: string,
  unit: string,
  lead: number,
  foil: number,
  rationale: string,
): ThresholdSpec {
  return {
    key,
    label,
    unit,
    rationale,
    defaultFor: (kind: TechniqueKind) => (kind === 'foil' ? foil : lead),
  }
}

/* -------------------------------------------------------------------------- */
/* min-piece-size — a piece too small to cut, hold and grind (warning→error)    */
/* -------------------------------------------------------------------------- */

const MIN_DIMENSION = perTechnique(
  'minDimensionMm',
  'Minimum piece size',
  'mm',
  10,
  6,
  'A piece narrower than this in its smallest dimension is hard to hold against the grinder and ' +
    'to foil or lead without burning or cracking it. Foil work goes finer than lead came, so its ' +
    'floor is lower. Below half the limit it is impractical to fabricate at all — an error.',
)

const minPieceSize: Rule = {
  id: 'min-piece-size',
  title: 'Piece too small',
  defaultSeverity: 'warning',
  explain:
    'This piece is smaller than the workshop minimum for its technique. Very small pieces are hard ' +
    'to hold safely against the grinder and to wrap or lead cleanly. Enlarge it, or merge it into a ' +
    'neighbour by removing the lead line between them.',
  thresholds: [MIN_DIMENSION],
  check: (input) => {
    const limit = resolveThreshold(input, 'min-piece-size', MIN_DIMENSION)
    const pieces = pieceById(input)
    const out: RawViolation[] = []
    for (const contour of input.cutContours) {
      if (contour.degenerate) continue // the degenerate-cut-contour rule owns these
      const minDim = Math.min(bboxWidth(contour.bbox), bboxHeight(contour.bbox))
      if (minDim >= limit) continue
      const piece = pieces.get(contour.pieceId)
      if (!piece) continue
      out.push({
        at: piece.centroid,
        message: `piece is ${mm(minDim)} mm across (minimum ${mm(limit)} mm)`,
        identity: [pieceKey(piece)],
        pieceIds: [piece.id],
        ...(minDim < limit / 2 ? { severity: 'error' as const } : {}),
      })
    }
    return out
  },
}

/* -------------------------------------------------------------------------- */
/* sliver — a long, thin piece that snaps when cut or handled (warning)         */
/* -------------------------------------------------------------------------- */

const SLIVER_WIDTH = perTechnique(
  'widthMm',
  'Sliver width',
  'mm',
  8,
  5,
  'A piece thinner than this along its whole length is a sliver: it flexes and snaps while being ' +
    'cut, ground or leaded. Measured as the inscribed width (the widest circle that fits inside the ' +
    'piece); flagged only when the piece is also more than four times as long as it is wide.',
)

const sliver: Rule = {
  id: 'sliver',
  title: 'Sliver',
  defaultSeverity: 'warning',
  explain:
    'This piece is long and thin — a sliver. Slivers crack along their length during cutting and ' +
    'handling and are hard to solder without melting through. Widen it, or split the run it borders ' +
    'so the sliver becomes part of a chunkier piece.',
  thresholds: [SLIVER_WIDTH],
  check: (input) => {
    const limit = resolveThreshold(input, 'sliver', SLIVER_WIDTH)
    const pieces = pieceById(input)
    const out: RawViolation[] = []
    for (const contour of input.cutContours) {
      if (contour.degenerate || contour.ring.length < 3) continue
      const circle = inscribedCircle(contour.ring, contour.holeRings)
      const width = circle.radius * 2
      if (width <= 0 || width >= limit) continue
      // Stable length proxy: for a thin piece area ≈ width × length, so length ≈ area / width.
      const length = contour.area / width
      if (length <= width * 4) continue
      const piece = pieces.get(contour.pieceId)
      out.push({
        at: circle.center,
        message: `piece is ${mm(width)} mm wide and ${mm(length)} mm long (minimum width ${mm(limit)} mm)`,
        identity: [piece ? pieceKey(piece) : contour.pieceId],
        ...(piece ? { pieceIds: [piece.id] } : {}),
      })
    }
    return out
  },
}

/* -------------------------------------------------------------------------- */
/* concave-curvature — an inside curve tighter than a break can run (warn→error)*/
/* -------------------------------------------------------------------------- */

const CONCAVE_RADIUS = fixed(
  'radiusMm',
  'Minimum inside-curve radius',
  'mm',
  15,
  'An inside (concave) curve can only be scored and broken down to a certain radius before the ' +
    'break runs off the line. Fifteen millimetres is a comfortable hand-cutting floor; grinding can ' +
    'rescue a somewhat tighter curve, so this is a warning until it gets truly tight.',
)

const CONCAVE_RADIUS_ERROR = fixed(
  'errorRadiusMm',
  'Impossible inside-curve radius',
  'mm',
  6,
  'Below this radius an inside curve cannot be cut by score-and-break at all, even with grinding — ' +
    'reported as an error rather than a warning.',
)

const concaveCurvature: Rule = {
  id: 'concave-curvature',
  title: 'Tight inside curve',
  defaultSeverity: 'warning',
  explain:
    'An inside curve here is tighter than a glass cutter can break — the score will not follow it and ' +
    'the piece breaks off the line. Soften the curve to a larger radius, or split the piece with a ' +
    'lead line so each side is a shallower cut.',
  thresholds: [CONCAVE_RADIUS, CONCAVE_RADIUS_ERROR],
  check: (input) => {
    const warnRadius = resolveThreshold(input, 'concave-curvature', CONCAVE_RADIUS)
    const errorRadius = resolveThreshold(input, 'concave-curvature', CONCAVE_RADIUS_ERROR)
    const segments = segmentsById(input.project)
    const out: RawViolation[] = []
    for (const piece of input.pieces) {
      for (const hit of concaveCurvatureHits(piece, segments)) {
        // The score follows the inset cut line, which tightens a concave radius by the edge
        // allowance — so the radius the cutter actually runs is smaller than the drawn one.
        const allowance = edgeAllowanceMm(input.project.technique, hit.segmentId)
        const radius = Math.max(0, hit.radiusMm - allowance)
        if (radius >= warnRadius) continue
        out.push({
          at: hit.at,
          message: `inside curve radius ${mm(radius)} mm (minimum ~${mm(warnRadius)} mm)`,
          identity: [pieceKey(piece), hit.segmentId],
          segmentIds: [hit.segmentId],
          pieceIds: [piece.id],
          ...(radius < errorRadius ? { severity: 'error' as const } : {}),
        })
      }
    }
    return out
  },
}

/* -------------------------------------------------------------------------- */
/* concave-notch — an inside corner too sharp to break (error, the flagship)    */
/* -------------------------------------------------------------------------- */

const NOTCH_ANGLE = fixed(
  'minWedgeAngleDeg',
  'Minimum inside-corner angle',
  '°',
  90,
  'An inside (reflex) corner is a V cut into the piece. The wedge of glass to remove must be scored ' +
    'edge-to-edge, but two scores meeting at a sharp inside corner cannot both run out — the glass ' +
    'cracks past the corner. Right-angle inside corners are the practical floor; anything sharper is ' +
    'flagged. Relieve the corner (round it, or split it into two pieces with a lead line).',
)

const concaveNotch: Rule = {
  id: 'concave-notch',
  title: 'Impossible inside cut',
  defaultSeverity: 'error',
  explain:
    'This inside corner is too sharp to cut. Glass is scored and broken edge-to-edge, so you cannot ' +
    'break a sharp notch out of the middle of a piece — it cracks past the corner every time. Round ' +
    'the corner, or split the piece with a lead line running through the corner so each side is an ' +
    'ordinary edge cut.',
  thresholds: [NOTCH_ANGLE],
  check: (input) => {
    const minWedge = resolveThreshold(input, 'concave-notch', NOTCH_ANGLE)
    const segments = segmentsById(input.project)
    const out: RawViolation[] = []
    for (const piece of input.pieces) {
      for (const corner of cornersOf(piece, segments)) {
        if (corner.convex) continue
        const wedgeDeg = 360 - corner.interiorAngle * DEG // the empty wedge cut into the glass
        if (wedgeDeg >= minWedge) continue
        out.push({
          at: corner.at,
          message: `inside corner of ${wedgeDeg.toFixed(0)}° (minimum ${minWedge.toFixed(0)}°)`,
          identity: [pieceKey(piece), key(corner.at)],
          segmentIds: [...corner.segmentIds],
          pieceIds: [piece.id],
        })
      }
    }
    return out
  },
}

/* -------------------------------------------------------------------------- */
/* sharp-point — a convex spike that is fragile at the tip (warning)            */
/* -------------------------------------------------------------------------- */

const POINT_ANGLE = fixed(
  'minAngleDeg',
  'Minimum point angle',
  '°',
  30,
  'A convex corner sharper than this makes a needle-thin tip that chips on the grinder and breaks ' +
    'in handling and soldering. Unlike an inside corner it can be cut, so this is a warning — but a ' +
    'slightly blunter point is far more durable.',
)

const sharpPoint: Rule = {
  id: 'sharp-point',
  title: 'Fragile point',
  defaultSeverity: 'warning',
  explain:
    'This piece comes to a very sharp point. The thin tip chips against the grinder and snaps while ' +
    'the piece is handled, foiled or soldered. Blunt the point a little, or absorb it into a lead ' +
    'joint, so the tip has some body.',
  thresholds: [POINT_ANGLE],
  check: (input) => {
    const minAngle = resolveThreshold(input, 'sharp-point', POINT_ANGLE)
    const segments = segmentsById(input.project)
    const out: RawViolation[] = []
    for (const piece of input.pieces) {
      for (const corner of cornersOf(piece, segments)) {
        if (!corner.convex) continue
        const angleDeg = corner.interiorAngle * DEG
        if (angleDeg >= minAngle) continue
        out.push({
          at: corner.at,
          message: `point angle ${angleDeg.toFixed(0)}° (minimum ${minAngle.toFixed(0)}°)`,
          identity: [pieceKey(piece), key(corner.at)],
          segmentIds: [...corner.segmentIds],
          pieceIds: [piece.id],
        })
      }
    }
    return out
  },
}

/* -------------------------------------------------------------------------- */
/* degenerate-cut-contour — a piece too small to inset at all (error)           */
/* -------------------------------------------------------------------------- */

/** Area (mm²) below which an inset contour has effectively collapsed — no glass left to cut. */
const COLLAPSED_AREA = 1

const degenerateCutContour: Rule = {
  id: 'degenerate-cut-contour',
  title: 'Piece cannot be cut',
  defaultSeverity: 'error',
  explain:
    'Insetting this piece by the lead or foil allowance folds it through itself — the piece is ' +
    'smaller than the width its own edges take up, so there is no glass left to cut. Enlarge it or ' +
    'merge it into a neighbour.',
  check: (input) => {
    const pieces = pieceById(input)
    const out: RawViolation[] = []
    for (const contour of input.cutContours) {
      // F-021 marks a contour degenerate whenever the offset self-intersects anywhere — including a
      // single sharp tip or tight bay folding locally, which the sharp-point / concave rules already
      // flag precisely. This rule fires only when the *whole* contour has collapsed (no cuttable
      // area is left), the spec's "too small to inset at all".
      if (!contour.degenerate) continue
      if (contour.ring.length >= 3 && contour.area > COLLAPSED_AREA) continue
      const piece = pieces.get(contour.pieceId)
      const at = piece?.centroid ?? centerOf(contour)
      out.push({
        at,
        message: 'piece is too small to inset by the technique allowance',
        identity: [piece ? pieceKey(piece) : contour.pieceId],
        ...(piece ? { pieceIds: [piece.id] } : {}),
      })
    }
    return out
  },
}

/** A rounded-position identity token (0.1 mm), stable while the geometry that produced it is. */
function key(p: Vec2): string {
  return `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`
}

function centerOf(contour: CutContour): Vec2 {
  return {
    x: (contour.bbox.min.x + contour.bbox.max.x) / 2,
    y: (contour.bbox.min.y + contour.bbox.max.y) / 2,
  }
}

/** The cuttability rule pack, in a stable display order (Scope). */
export const CUTTABILITY_RULES: readonly Rule[] = [
  minPieceSize,
  sliver,
  concaveCurvature,
  concaveNotch,
  sharpPoint,
  degenerateCutContour,
]
