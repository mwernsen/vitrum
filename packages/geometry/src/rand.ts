import type { Arc, CubicBezier, Line } from './types'
import { arc, cubic, line } from './types'
import { vec2, type Vec2 } from './vec2'

/**
 * Deterministic pseudo-random helpers for the property-based suites (F-010 FR-4). A
 * seeded generator keeps failures reproducible — a broken property always fails on the
 * same case, so it can be pasted into a focused unit test. Not exported from the
 * package barrel; test-only.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function makeRng(seed: number): {
  next: () => number
  between: (lo: number, hi: number) => number
  point: (span?: number) => Vec2
  line: () => Line
  arc: () => Arc
  cubic: () => CubicBezier
} {
  const next = mulberry32(seed)
  const between = (lo: number, hi: number): number => lo + next() * (hi - lo)
  const point = (span = 100): Vec2 => vec2(between(-span, span), between(-span, span))
  return {
    next,
    between,
    point,
    line: () => line(point(), point()),
    arc: () =>
      arc(
        point(50),
        between(5, 60),
        between(0, Math.PI * 2),
        between(0, Math.PI * 2),
        next() > 0.5,
      ),
    cubic: () => cubic(point(), point(), point(), point()),
  }
}
