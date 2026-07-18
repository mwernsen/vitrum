import type { BBox, Curve, Vec2 } from '@vitrum/geometry'
import { bboxContainsPoint, bboxOf, bboxOverlap, flattenCurve } from '@vitrum/geometry'

import type { PickTarget } from './pick'

/**
 * Marquee (rubber-band) selection with AutoCAD window/crossing semantics (F-013 FR-3):
 *
 * - **window** (drag left → right): selects only targets lying *entirely* inside the box.
 * - **crossing** (drag right → left): selects any target the box *touches* — inside or crossed.
 *
 * Curves are tested against their flattened polyline, so a long line that passes through the
 * box with neither endpoint inside is still a crossing hit, and a curve whose bbox overlaps the
 * box but whose actual path stays outside is not.
 */
export type MarqueeMode = 'window' | 'crossing'

/** Pick the mode from the drag direction: left→right is window, right→left is crossing. */
export function marqueeMode(from: Vec2, to: Vec2): MarqueeMode {
  return to.x >= from.x ? 'window' : 'crossing'
}

/** Flatten tolerance (mm) for marquee curve tests — fine enough for selection, cheap. */
const FLATTEN_TOL = 0.25

/** The ids of targets selected by the marquee `rect` under `mode`. */
export function marqueeSelect(
  targets: readonly PickTarget[],
  rect: BBox,
  mode: MarqueeMode,
): string[] {
  const out: string[] = []
  for (const target of targets) {
    const box = bboxOf(target.geometry)
    if (mode === 'window') {
      if (bboxInside(box, rect)) out.push(target.id)
    } else if (bboxOverlap(box, rect) && curveCrossesRect(target.geometry, rect)) {
      out.push(target.id)
    }
  }
  return out
}

/** True when `inner` is fully within `outer`. */
function bboxInside(inner: BBox, outer: BBox): boolean {
  return (
    inner.min.x >= outer.min.x &&
    inner.min.y >= outer.min.y &&
    inner.max.x <= outer.max.x &&
    inner.max.y <= outer.max.y
  )
}

/** True when the curve has any point inside `rect` or any span crossing a `rect` edge. */
function curveCrossesRect(curve: Curve, rect: BBox): boolean {
  const pts = flattenCurve(curve, FLATTEN_TOL)
  for (const p of pts) if (bboxContainsPoint(rect, p)) return true
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentIntersectsRect(pts[i]!, pts[i + 1]!, rect)) return true
  }
  return false
}

/**
 * Liang–Barsky segment-vs-axis-aligned-box clip: true when segment `a`→`b` intersects `rect`.
 * Catches a span that passes straight through the box with neither endpoint inside.
 */
function segmentIntersectsRect(a: Vec2, b: Vec2, rect: BBox): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let t0 = 0
  let t1 = 1
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0 // parallel: inside iff q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  return (
    clip(-dx, a.x - rect.min.x) &&
    clip(dx, rect.max.x - a.x) &&
    clip(-dy, a.y - rect.min.y) &&
    clip(dy, rect.max.y - a.y) &&
    t0 <= t1
  )
}
