import type { Arc, CubicBezier, Line, Vec2 } from '@vitrum/geometry'

/**
 * Live symmetry (F-052): the pure, model-free view of the symmetry setup and the network it
 * replicates. Like piece detection (F-020) and the drawing tools (F-011), `packages/core`
 * mirrors `@vitrum/model`'s `Segment`/`Node` **structurally** rather than importing the model,
 * so the transform stays a leaf with no `core → model` edge. `@vitrum/model`'s `SymmetrySetup`
 * and `Segment` satisfy these shapes verbatim, so the shell hands them straight in.
 *
 * Replicas are *derived* — never stored. The document keeps only the source network plus this
 * setup; expansion (see `expand.ts`) reproduces the full replicated network on demand for
 * piece detection, DRC and every output. Bake (F-052 FR-3) is the one place derived replicas
 * become ordinary stored segments.
 */

/** The geometry a network segment can carry (mirrors `@vitrum/model`'s `SegmentGeometry`). */
export type SymGeometry = Line | Arc | CubicBezier

/**
 * A network segment as symmetry expansion sees it — structurally a subset of `@vitrum/model`'s
 * `Segment`, so callers pass model segments (or F-020 `PieceSegment`s) directly. `endpoints` are
 * the `[start, end]` node ids; expansion derives new, deterministic ids for the replicas so that
 * two source segments sharing a node have replicas that share a node too (welds survive per
 * sector by construction; seam welds across sectors are left to F-020 clustering — Decision §4).
 */
export interface NetworkSegment {
  readonly id: string
  readonly geometry: SymGeometry
  readonly role: 'lead' | 'construction' | 'border'
  readonly endpoints: readonly [string, string]
}

/** The kind of symmetry a project is set up with. `none` disables replication entirely. */
export type SymmetryMode = 'none' | 'mirror' | 'double-mirror' | 'radial'

/**
 * The persisted symmetry setup (F-052 Decision §2) — **setup only**, no geometry. `center` is the
 * mirror/rotation origin in world mm; `angle` (radians) orients the primary axis. `count` is the
 * radial N-fold order (used only when `mode === 'radial'`, clamped ≥ 2); `mirror` adds a reflected
 * copy to each radial sector (a full dihedral group). For `mirror` the single axis is `angle`; for
 * `double-mirror` the two axes are `angle` and `angle + π/2`.
 */
export interface SymmetrySetup {
  readonly mode: SymmetryMode
  readonly center: Vec2
  readonly angle: number
  readonly count: number
  readonly mirror: boolean
}

/** A fresh, inert symmetry setup (no replication). Center at the origin, primary axis vertical. */
export function noSymmetry(center: Vec2 = { x: 0, y: 0 }): SymmetrySetup {
  return { mode: 'none', center, angle: Math.PI / 2, count: 6, mirror: false }
}
