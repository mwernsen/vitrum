/**
 * The drawing-tool framework (F-011): pure, framework-free tool state machines plus the
 * snapping hook the UI decorates. `ToolController` in `packages/ui` drives these with
 * real pointer/key events and turns their commits into document commands.
 */

export {
  identityResolver,
  type DrawGeometry,
  type DrawRole,
  type NumericValue,
  type PointerInput,
  type PointerResolver,
  type PreviewShape,
  type ResolveContext,
  type ResolvedPoint,
  type SegmentDraft,
  type SnapResult,
  type ToolDef,
  type ToolId,
  type ToolInput,
  type ToolStep,
} from './types'

export { constrainAngle, placeNumeric } from './constrain'
export { isNumericChar, parseNumericEntry } from './numeric'
export {
  ellipseDrafts,
  rectangleCorners,
  rectangleDrafts,
  regularPolygonDrafts,
  regularPolygonVertices,
} from './shapes'

export { lineTool, type LineState } from './line'
export {
  arcFromCenter,
  arcThroughPoints,
  arcTool,
  circumcenter,
  type ArcMode,
  type ArcState,
} from './arc'
export { bezierTool, type BezierAnchor, type BezierState } from './bezier'
export {
  borderTool,
  circleTool,
  makeSpanTool,
  polygonTool,
  rectangleTool,
  type SpanState,
} from './spantools'
