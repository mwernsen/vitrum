export { pieceKey, resolveGeneration } from './assignment'
export { detectPieces, PieceDetector, type PlanarGraph } from './detect'
export { buildGraph, type GraphEdge } from './graph'
export { contentId, matchIds, matchIdsWithLineage, type LineageResult } from './identity'
export {
  assignGlassCodes,
  codeAt,
  labelPlacement,
  renumber,
  rowMajorOrder,
  UNASSIGNED_CODE,
  type LabelPlacement,
  type NumberingScheme,
  type RenumberInput,
  type RenumberResult,
} from './numbering'
export { spanPoints } from './properties'
export {
  DETECT_DEFAULTS,
  type BoundarySpan,
  type Diagnostic,
  type DiagnosticKind,
  type DetectionResult,
  type DetectOptions,
  type Piece,
  type PieceGeometry,
  type PieceId,
  type PieceSegment,
  type PieceSegmentRole,
} from './types'
