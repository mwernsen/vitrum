export { binarise, despeckle, fillHoles, rgbaToGrey, type DespeckleResult } from './binarise'
export { orientRgba, orientationSwapsAxes, readExifOrientation, type ExifOrientation } from './exif'
export { TRACE_MAX_PX, pixelPointToWorld, pixelToWorld, sampleGrid, traceGridFor } from './raster'
export { pruneSpurs, runLength, walkSkeleton, type SkeletonRun } from './skeleton'
export { neighbourCounts, thin } from './thin'
export { defaultTraceOptions, traceBitmap } from './trace'
export type {
  GreyBitmap,
  InkMask,
  TraceGrid,
  TraceOptions,
  TraceResult,
  TraceSummary,
} from './types'
export { splitAtCorners, vectoriseRun, type VectoriseOptions } from './vectorise'
