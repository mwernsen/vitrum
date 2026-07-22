import {
  applyToPoint,
  arc,
  compose,
  determinant,
  rotation,
  transformShape,
  translation,
  vec2,
  type Transform2D,
  type Vec2,
} from '@vitrum/geometry'

import type { SymGeometry, SymmetrySetup } from './types'

/**
 * The group of affine transforms a symmetry setup replicates the source under (F-052). Element
 * 0 is always the identity (the source itself); the rest are the replica placements. Pure and
 * deterministic — the order depends only on the setup, so derived ids are reproducible.
 */

/** Reflection across the line through `center` at `angle` (radians). Determinant −1. */
export function reflection(angle: number, center: Vec2): Transform2D {
  const c2 = Math.cos(2 * angle)
  const s2 = Math.sin(2 * angle)
  // Reflect about a line through the origin, then re-anchor at `center`.
  const about: Transform2D = { a: c2, b: s2, c: s2, d: -c2, e: 0, f: 0 }
  return compose(translation(center.x, center.y), about, translation(-center.x, -center.y))
}

/** Clamp a radial fold count to a sane integer (≥ 2). */
export function radialCount(setup: SymmetrySetup): number {
  return Math.max(2, Math.floor(setup.count))
}

/**
 * The ordered list of symmetry-group transforms for a setup, identity first. Multiplicity:
 * none ×1, mirror ×2, double-mirror ×4, radial-N ×N, radial-N + mirror ×2N (F-052 FR-1).
 */
export function symmetryTransforms(setup: SymmetrySetup): Transform2D[] {
  const { center, angle } = setup
  switch (setup.mode) {
    case 'none':
      return [IDENTITY]
    case 'mirror':
      return [IDENTITY, reflection(angle, center)]
    case 'double-mirror':
      return [
        IDENTITY,
        reflection(angle, center),
        reflection(angle + Math.PI / 2, center),
        rotation(Math.PI, center),
      ]
    case 'radial': {
      const n = radialCount(setup)
      const step = (2 * Math.PI) / n
      const rotations: Transform2D[] = []
      for (let k = 0; k < n; k++) rotations.push(rotation(k * step, center))
      if (!setup.mirror) return rotations
      // Dihedral D_n: each rotation, plus that rotation followed by the primary-axis reflection.
      const s = reflection(angle, center)
      const reflections = rotations.map((r) => compose(s, r))
      return [...rotations, ...reflections]
    }
  }
}

const IDENTITY: Transform2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }

/**
 * Apply an affine transform to a segment geometry, allowing **reflections** (unlike the kernel's
 * `transformShape`, which refuses to reflect an arc). A reflected circular arc is still a circular
 * arc — reflected center, same radius, angles mapped `φ → 2α − φ` and winding flipped — so replicas
 * keep arcs as arcs (F-052 FR-3 / the F-050 "arcs stay kernel arcs" learning). Rotations and
 * translations fall through to the kernel.
 */
export function transformSymGeometry(t: Transform2D, geometry: SymGeometry): SymGeometry {
  if (geometry.kind !== 'arc' || determinant(t) > 0) {
    return transformShape(t, geometry) as SymGeometry
  }
  // Orientation-reversing transform (a reflection). Reflect the arc analytically.
  const scale = Math.sqrt(t.a * t.a + t.b * t.b)
  const refl = Math.atan2(t.b, t.a) // 2α for a reflection whose axis is at angle α
  return arc(
    applyToPoint(t, geometry.center),
    geometry.radius * scale,
    refl - geometry.startAngle,
    refl - geometry.endAngle,
    !geometry.ccw,
  )
}

/** The `[start, end]` world points of a geometry (arc endpoints computed). */
export function geometryEnds(g: SymGeometry): readonly [Vec2, Vec2] {
  switch (g.kind) {
    case 'line':
      return [g.a, g.b]
    case 'cubic':
      return [g.p0, g.p3]
    case 'arc': {
      const s = vec2(
        g.center.x + g.radius * Math.cos(g.startAngle),
        g.center.y + g.radius * Math.sin(g.startAngle),
      )
      const e = vec2(
        g.center.x + g.radius * Math.cos(g.endAngle),
        g.center.y + g.radius * Math.sin(g.endAngle),
      )
      return [s, e]
    }
  }
}
