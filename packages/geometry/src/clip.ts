import Flatten from '@flatten-js/core'

import { bboxOfPoints, bboxOverlap } from './bbox'
import { pointInRing, signedArea } from './polygon'
import type { Vec2 } from './vec2'

/**
 * Polygon boolean helpers built on `@flatten-js/core`'s robust boolean ops, kept behind
 * this module so the rest of the kernel stays library-agnostic (same policy as
 * `convert.ts`/`intersect.ts`). The single consumer today is F-020's stable-piece-identity
 * matcher, which scores how much a new face overlaps a previous piece — so the exactness
 * bar is "good enough to rank candidates", not CAD-grade booleans.
 */

const { BooleanOperations } = Flatten

function toFlPolygon(ring: readonly Vec2[]): InstanceType<typeof Flatten.Polygon> {
  const poly = new Flatten.Polygon()
  poly.addFace(ring.map((p) => Flatten.point(p.x, p.y)))
  return poly
}

/**
 * Area of the geometric intersection of two simple polygon rings, in mm². Winding is
 * irrelevant (the rings are normalized to CCW first). Returns 0 when the rings' bounding
 * boxes are disjoint. If the underlying boolean op throws on a degenerate input (rare —
 * flatten-js is robust but not infallible), falls back to a conservative estimate: the
 * smaller ring's area when its centroid-ish vertex lies inside the other, else 0. That
 * keeps the identity matcher deterministic and total rather than crashing detection.
 */
export function overlapArea(ringA: readonly Vec2[], ringB: readonly Vec2[]): number {
  if (ringA.length < 3 || ringB.length < 3) return 0
  if (!bboxOverlap(bboxOfPoints(ringA), bboxOfPoints(ringB))) return 0

  const a = signedArea(ringA) > 0 ? ringA : [...ringA].reverse()
  const b = signedArea(ringB) > 0 ? ringB : [...ringB].reverse()

  try {
    const result = BooleanOperations.intersect(toFlPolygon(a), toFlPolygon(b))
    return Math.abs(result.area())
  } catch {
    // Degenerate boolean — approximate. If any vertex of the smaller ring is inside the
    // larger, treat the whole smaller area as overlapping; otherwise report no overlap.
    const areaA = Math.abs(signedArea(a))
    const areaB = Math.abs(signedArea(b))
    const [small, large] = areaA <= areaB ? [a, b] : [b, a]
    const smallArea = Math.min(areaA, areaB)
    return small.some((p) => pointInRing(large, p)) ? smallArea : 0
  }
}
