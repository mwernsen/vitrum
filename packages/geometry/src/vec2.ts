import { EPS, isZero } from './epsilon'

/**
 * A 2D point or direction in millimetres. Plain data (no class, no hidden state) so
 * instances are trivially structured-cloneable into workers — DRC and nesting will run
 * this kernel off the main thread (F-010 technical guidance).
 */
export interface Vec2 {
  readonly x: number
  readonly y: number
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y }
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s }
}

/** Component-wise linear interpolation; `t = 0` yields `a`, `t = 1` yields `b`. */
export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

/** 2D cross product (z-component of the 3D cross): positive when `b` is left of `a`. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y)
}

export function lengthSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y
}

/** Euclidean distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/** Unit vector in the direction of `a`; returns `{0,0}` for a (near-)zero vector. */
export function normalize(a: Vec2): Vec2 {
  const len = length(a)
  return isZero(len) ? { x: 0, y: 0 } : { x: a.x / len, y: a.y / len }
}

/** Left normal (90° CCW rotation). For a travel direction, this points to its left. */
export function leftNormal(a: Vec2): Vec2 {
  return { x: -a.y, y: a.x }
}

/** Right normal (90° CW rotation). */
export function rightNormal(a: Vec2): Vec2 {
  return { x: a.y, y: -a.x }
}

/** Rotate `a` about the origin by `angle` radians (CCW positive). */
export function rotate(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

/** Angle of the vector from the +x axis, in `(-π, π]`. */
export function angle(a: Vec2): number {
  return Math.atan2(a.y, a.x)
}

export function negate(a: Vec2): Vec2 {
  return { x: -a.x, y: -a.y }
}

/** Are two points coincident within the absolute tolerance `tol`? */
export function equals(a: Vec2, b: Vec2, tol = EPS): boolean {
  return distance(a, b) <= tol
}
