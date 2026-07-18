import type { Vec2 } from '@vitrum/geometry'
import { EPS, arc, cubic, equals, line, vec2 } from '@vitrum/geometry'

import type { DrawRole, SegmentDraft } from './types'

/** The four corners of the axis-aligned rectangle spanned by two opposite corners. */
export function rectangleCorners(a: Vec2, b: Vec2): [Vec2, Vec2, Vec2, Vec2] {
  return [vec2(a.x, a.y), vec2(b.x, a.y), vec2(b.x, b.y), vec2(a.x, b.y)]
}

/** Close a ring of corner points into welded line drafts (each shares the next's start). */
function ringDrafts(corners: readonly Vec2[], role: DrawRole): SegmentDraft[] {
  const drafts: SegmentDraft[] = []
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!
    const b = corners[(i + 1) % corners.length]!
    if (equals(a, b)) continue
    drafts.push({ geometry: line(a, b), role })
  }
  return drafts
}

/**
 * A rectangle as four welded line segments (F-011 shape tools): ordinary segments, not a
 * special object, so piece detection treats it uniformly. Corners are shared exact values,
 * so the loop is closed with coincident nodes for F-020. Empty when the rectangle is
 * degenerate (zero width or height).
 */
export function rectangleDrafts(a: Vec2, b: Vec2, role: DrawRole = 'lead'): SegmentDraft[] {
  if (Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS) return []
  return ringDrafts(rectangleCorners(a, b), role)
}

/** The `sides` vertices of a regular polygon, first vertex toward `vertex` from `center`. */
export function regularPolygonVertices(center: Vec2, vertex: Vec2, sides: number): Vec2[] {
  const n = Math.max(3, Math.round(sides))
  const dx = vertex.x - center.x
  const dy = vertex.y - center.y
  const radius = Math.hypot(dx, dy)
  const base = Math.atan2(dy, dx)
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const angle = base + (i * 2 * Math.PI) / n
    out.push(vec2(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle)))
  }
  return out
}

/** A regular N-gon as welded line segments. Empty when the radius is degenerate. */
export function regularPolygonDrafts(
  center: Vec2,
  vertex: Vec2,
  sides: number,
  role: DrawRole = 'lead',
): SegmentDraft[] {
  if (Math.hypot(vertex.x - center.x, vertex.y - center.y) < EPS) return []
  return ringDrafts(regularPolygonVertices(center, vertex, sides), role)
}

/** Bézier handle length that approximates a quarter ellipse to ~0.02% (the classic κ). */
const KAPPA = 0.5522847498307936

/**
 * A circle or axis-aligned ellipse with semi-axes `rx`/`ry` about `center` (F-011 shape
 * tools). A true circle (rx ≈ ry) is one exact full-circle {@link arc}; an ellipse is four
 * welded cubic Béziers (the kernel is circular-only, so ellipses are emitted as curves —
 * F-010's resolved decision). Empty when either axis is degenerate.
 */
export function ellipseDrafts(
  center: Vec2,
  rx: number,
  ry: number,
  role: DrawRole = 'lead',
): SegmentDraft[] {
  if (rx < EPS || ry < EPS) return []
  if (Math.abs(rx - ry) < EPS) {
    return [{ geometry: arc(center, rx, 0, 2 * Math.PI, true), role }]
  }
  const { x: cx, y: cy } = center
  const kx = KAPPA * rx
  const ky = KAPPA * ry
  // Four quadrant points on the ellipse (0°, 90°, 180°, 270°).
  const p0 = vec2(cx + rx, cy)
  const p1 = vec2(cx, cy + ry)
  const p2 = vec2(cx - rx, cy)
  const p3 = vec2(cx, cy - ry)
  const quads = [
    cubic(p0, vec2(cx + rx, cy + ky), vec2(cx + kx, cy + ry), p1),
    cubic(p1, vec2(cx - kx, cy + ry), vec2(cx - rx, cy + ky), p2),
    cubic(p2, vec2(cx - rx, cy - ky), vec2(cx - kx, cy - ry), p3),
    cubic(p3, vec2(cx + kx, cy - ry), vec2(cx + rx, cy - ky), p0),
  ]
  return quads.map((geometry) => ({ geometry, role }))
}
