import { newSegmentId } from './ids'
import type { Segment, SegmentGeometry, SegmentRole } from './types'

/**
 * Build a segment with a fresh stable id. Id generation is isolated here (and in
 * `ids.ts`) so commands stay pure: a tool calls `createSegment`, then feeds the result
 * to `addSegment`, keeping the impure step out of the undoable command itself.
 */
export function createSegment(geometry: SegmentGeometry, role: SegmentRole = 'lead'): Segment {
  return { id: newSegmentId(), geometry, role }
}
