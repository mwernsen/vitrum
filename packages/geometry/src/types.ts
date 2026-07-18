import type { Vec2 } from './vec2'

/**
 * The kernel's primitive vocabulary. Every shape is a discriminated union member
 * tagged by `kind`, so generic operations (`intersect`, `length`, `bboxOf`, …) can
 * dispatch on the tag without `instanceof`. All shapes are plain readonly data.
 *
 * Parameter conventions used throughout:
 * - `Line`, `CubicBezier`: natural parameter `t ∈ [0, 1]` from start to end.
 * - `Arc`: `t ∈ [0, 1]` mapped linearly onto the swept angle from `startAngle` to
 *   `endAngle` in the direction given by `ccw`.
 * - `Polyline`: `t ∈ [0, 1]` where segment `i` (of `n`) spans `[i/n, (i+1)/n]`.
 */

/** A straight segment from `a` to `b`. */
export interface Line {
  readonly kind: 'line'
  readonly a: Vec2
  readonly b: Vec2
}

/**
 * A circular arc. `startAngle`/`endAngle` are measured from the +x axis; `ccw` picks
 * the sweep direction. v1 is circular only — elliptical arcs are converted to béziers
 * at SVG import (F-050), per the resolved F-010 open question.
 */
export interface Arc {
  readonly kind: 'arc'
  readonly center: Vec2
  readonly radius: number
  readonly startAngle: number
  readonly endAngle: number
  readonly ccw: boolean
}

/** A cubic Bézier with endpoints `p0`/`p3` and control points `p1`/`p2`. */
export interface CubicBezier {
  readonly kind: 'cubic'
  readonly p0: Vec2
  readonly p1: Vec2
  readonly p2: Vec2
  readonly p3: Vec2
}

/** An open chain of ≥2 points connected by straight segments. */
export interface Polyline {
  readonly kind: 'polyline'
  readonly points: readonly Vec2[]
}

/**
 * A closed region: one outer ring plus zero or more hole rings. Rings are lists of
 * vertices in order **without** repeating the first point at the end (matching the
 * existing `GlassPiece` convention in `@vitrum/core`). By convention the outer ring is
 * CCW and holes are CW, but helpers normalize orientation where it matters rather than
 * trusting the caller.
 */
export interface Polygon {
  readonly kind: 'polygon'
  readonly outer: readonly Vec2[]
  readonly holes: readonly (readonly Vec2[])[]
}

/** An axis-aligned bounding box. `min`/`max` are the low/high corners. */
export interface BBox {
  readonly min: Vec2
  readonly max: Vec2
}

/** Any parametric curve the kernel can measure, split, flatten and intersect. */
export type Curve = Line | Arc | CubicBezier | Polyline

/** Any shape with a bounding box. */
export type Shape = Curve | Polygon

export function line(a: Vec2, b: Vec2): Line {
  return { kind: 'line', a, b }
}

export function arc(
  center: Vec2,
  radius: number,
  startAngle: number,
  endAngle: number,
  ccw = true,
): Arc {
  return { kind: 'arc', center, radius, startAngle, endAngle, ccw }
}

export function cubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2): CubicBezier {
  return { kind: 'cubic', p0, p1, p2, p3 }
}

export function polyline(points: readonly Vec2[]): Polyline {
  return { kind: 'polyline', points }
}

export function polygon(outer: readonly Vec2[], holes: readonly (readonly Vec2[])[] = []): Polygon {
  return { kind: 'polygon', outer, holes }
}

export function isLine(c: Shape): c is Line {
  return c.kind === 'line'
}

export function isArc(c: Shape): c is Arc {
  return c.kind === 'arc'
}

export function isCubic(c: Shape): c is CubicBezier {
  return c.kind === 'cubic'
}

export function isPolyline(c: Shape): c is Polyline {
  return c.kind === 'polyline'
}

export function isPolygon(c: Shape): c is Polygon {
  return c.kind === 'polygon'
}
