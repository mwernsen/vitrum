/**
 * `@vitrum/geometry` — the pure 2D CAD kernel (F-010). No DOM, no rendering, no
 * document model; every export is data plus free functions so the package runs
 * unchanged in a Web Worker (DRC, nesting) later. See `README.md` for the epsilon
 * strategy and the buy-vs-build decision behind the `@flatten-js/core` / `bezier-js`
 * wrapping.
 */

// Numerical hygiene
export { ANGLE_EPS, EPS, clamp, clamp01, eq, isZero } from './epsilon'

// Primitives and constructors
export {
  arc,
  cubic,
  isArc,
  isCubic,
  isLine,
  isPolygon,
  isPolyline,
  line,
  polygon,
  polyline,
  type Arc,
  type BBox,
  type CubicBezier,
  type Curve,
  type Line,
  type Polygon,
  type Polyline,
  type Shape,
} from './types'

// Vectors
export {
  add,
  angle,
  cross,
  distance,
  distanceSq,
  dot,
  equals,
  leftNormal,
  length,
  lengthSq,
  lerp,
  negate,
  normalize,
  rightNormal,
  rotate,
  scale,
  sub,
  vec2,
  type Vec2,
} from './vec2'

// Bounding boxes
export {
  bboxCenter,
  bboxContainsPoint,
  bboxExpand,
  bboxHeight,
  bboxOf,
  bboxOfPoints,
  bboxOverlap,
  bboxUnion,
  bboxWidth,
} from './bbox'

// Arc / cubic geometry
export {
  arcAngleAt,
  arcEnd,
  arcPointAt,
  arcStart,
  arcSweep,
  arcTangentAt,
  arcToCubics,
} from './arcmath'
export {
  cubicAcceleration,
  cubicCurvatureAt,
  cubicFlatten,
  cubicLength,
  cubicPointAt,
  cubicSplitAt,
  cubicTangentAt,
  cubicVelocity,
} from './cubicmath'

// Queries
export {
  closestPoint,
  curvatureAt,
  flatten as flattenCurve,
  length as curveLength,
  pointAt,
  splitAt,
  tangentAt,
  type ClosestPoint,
} from './measure'

// Polygons
export {
  area,
  centroid,
  ensureWinding,
  isCCW,
  normalizePolygon,
  pointInPolygon,
  pointInRing,
  signedArea,
} from './polygon'

// Intersection
export { intersect, type Intersection } from './intersect'

// Offset
export {
  offsetArc,
  offsetCubic,
  offsetLine,
  offsetPolygon,
  offsetPolyline,
  type OffsetResult,
} from './offset'

// Simplification
export { douglasPeucker, removeCollinear, simplifyPolyline } from './simplify'

// Transforms
export {
  IDENTITY,
  applyToPoint,
  applyToVector,
  compose,
  determinant,
  isSimilarity,
  rotation,
  scaling,
  transformCurve,
  transformShape,
  translation,
  type Transform2D,
} from './transform'
