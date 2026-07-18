import { arcAngleAt, arcEnd, arcSweep, arcStart } from './arcmath'
import { toBezier } from './convert'
import type { Arc, BBox, Shape } from './types'
import { vec2, type Vec2 } from './vec2'

const TWO_PI = Math.PI * 2

/** The bounding box of a set of points. Throws on an empty input. */
export function bboxOfPoints(points: readonly Vec2[]): BBox {
  if (points.length === 0) throw new Error('bboxOfPoints: no points')
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { min: vec2(minX, minY), max: vec2(maxX, maxY) }
}

/** Tight bounding box of any primitive. Arcs and Béziers use true extrema, not hulls. */
export function bboxOf(shape: Shape): BBox {
  switch (shape.kind) {
    case 'line':
      return bboxOfPoints([shape.a, shape.b])
    case 'polyline':
      return bboxOfPoints(shape.points)
    case 'polygon':
      return bboxOfPoints(shape.outer)
    case 'arc':
      return arcBBox(shape)
    case 'cubic': {
      const b = toBezier(shape).bbox()
      return { min: vec2(b.x.min, b.y.min), max: vec2(b.x.max, b.y.max) }
    }
  }
}

function arcBBox(a: Arc): BBox {
  const pts: Vec2[] = [arcStart(a), arcEnd(a)]
  // A circle's extremes sit at the four cardinal angles; include each that the sweep
  // actually reaches, so the box hugs the arc instead of its chord.
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2
    if (arcContainsAngle(a, ang)) {
      pts.push(vec2(a.center.x + Math.cos(ang) * a.radius, a.center.y + Math.sin(ang) * a.radius))
    }
  }
  return bboxOfPoints(pts)
}

function arcContainsAngle(a: Arc, angle: number): boolean {
  const sweep = arcSweep(a)
  const base = arcAngleAt(a, 0)
  let rel = a.ccw ? angle - base : base - angle
  rel %= TWO_PI
  if (rel < 0) rel += TWO_PI
  return rel <= sweep + 1e-9
}

/** Smallest box containing both inputs. */
export function bboxUnion(a: BBox, b: BBox): BBox {
  return {
    min: vec2(Math.min(a.min.x, b.min.x), Math.min(a.min.y, b.min.y)),
    max: vec2(Math.max(a.max.x, b.max.x), Math.max(a.max.y, b.max.y)),
  }
}

/** Grow (or shrink, for negative `d`) a box by `d` on every side. */
export function bboxExpand(box: BBox, d: number): BBox {
  return {
    min: vec2(box.min.x - d, box.min.y - d),
    max: vec2(box.max.x + d, box.max.y + d),
  }
}

/** Do two boxes overlap, treating a shared edge/corner (within `tol`) as overlap? */
export function bboxOverlap(a: BBox, b: BBox, tol = 0): boolean {
  return (
    a.min.x <= b.max.x + tol &&
    a.max.x >= b.min.x - tol &&
    a.min.y <= b.max.y + tol &&
    a.max.y >= b.min.y - tol
  )
}

/** Is a point inside or on the box (within `tol`)? */
export function bboxContainsPoint(box: BBox, p: Vec2, tol = 0): boolean {
  return (
    p.x >= box.min.x - tol &&
    p.x <= box.max.x + tol &&
    p.y >= box.min.y - tol &&
    p.y <= box.max.y + tol
  )
}

export function bboxCenter(box: BBox): Vec2 {
  return vec2((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2)
}

export function bboxWidth(box: BBox): number {
  return box.max.x - box.min.x
}

export function bboxHeight(box: BBox): number {
  return box.max.y - box.min.y
}
