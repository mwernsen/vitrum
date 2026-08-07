import { douglasPeucker, fitCubics, isNearlyStraight, line, type Vec2 } from '@vitrum/geometry'

import type { DrawGeometry } from '../tools/types'

import { pixelPointToWorld } from './raster'
import type { SkeletonRun } from './skeleton'
import type { TraceGrid } from './types'

/**
 * Turning skeleton runs into editable geometry (F-059).
 *
 * Three decisions, in order:
 *
 * 1. **Simplify** (Douglas–Peucker) to shed the ±0.5 px staircase every rasterised line has. Without
 *    it the curve fitter chases pixel noise and emits dozens of tiny spans.
 * 2. **Break at corners.** A drawn right angle that happens to have no third branch arrives as one
 *    degree-2 run; fitting a smooth curve through it would round off the corner the designer drew. So
 *    the run splits wherever it turns hard, and each piece is fitted separately.
 * 3. **Line or curve.** A piece that stays within tolerance of its own chord becomes a `Line` —
 *    straight lead lines should be straight, not a cubic that happens to look straight.
 *
 * Total geometric error against the skeleton is at most `simplifyMm + fitMm`; both are user controls.
 */

/** How sharp a turn (degrees) counts as a corner to break the run at, rather than a curve to fit. */
const CORNER_DEGREES = 35

export interface VectoriseOptions {
  readonly simplifyMm: number
  /** Curve-fit tolerance in mm. At 0 the polyline is kept as a chain of straight segments. */
  readonly fitMm: number
  /**
   * Shortest arm (mm) a vertex needs on *both* sides to count as a drawn corner. Rasterised diagonals
   * are staircases, so a simplified skeleton run is full of 45° and 90° jogs one pixel long; without
   * this guard every drawn diagonal would be chopped into a handful of collinear stubs. Pass roughly
   * one stroke width — a corner the designer drew always has arms far longer than the pen is wide.
   */
  readonly cornerMinArmMm: number
}

/** Vectorise one skeleton run (pixel coordinates) into world-mm geometry. */
export function vectoriseRun(
  run: SkeletonRun,
  grid: TraceGrid,
  options: VectoriseOptions,
): DrawGeometry[] {
  const world = run.points.map((p) => pixelPointToWorld(grid, p))
  if (world.length < 2) return []

  const simplified = simplifyRun(world, Math.max(options.simplifyMm, 0), run.closed)
  if (simplified.length < 2) return []

  if (options.fitMm <= 0) return chainOfLines(simplified)

  const out: DrawGeometry[] = []
  for (const piece of splitAtCorners(simplified, options.cornerMinArmMm)) {
    if (piece.length < 2) continue
    if (isNearlyStraight(piece, options.fitMm)) {
      const a = piece[0]!
      const b = piece[piece.length - 1]!
      if (!samePoint(a, b)) out.push(line(a, b))
      continue
    }
    out.push(...fitCubics(piece, options.fitMm))
  }
  return out
}

/**
 * Douglas–Peucker, with the closed case handled by rotating the ring so the simplification cannot
 * move the seam: the seam vertex is pinned as both ends, which is exactly what DP preserves.
 */
function simplifyRun(points: readonly Vec2[], tol: number, closed: boolean): Vec2[] {
  if (tol <= 0) return [...points]
  const simplified = douglasPeucker(points, tol)
  if (!closed) return simplified
  // Keep the loop closed even if DP dropped the repeated seam point.
  if (simplified.length >= 3 && !samePoint(simplified[0]!, simplified[simplified.length - 1]!)) {
    simplified.push(simplified[0]!)
  }
  return simplified
}

function chainOfLines(points: readonly Vec2[]): DrawGeometry[] {
  const out: DrawGeometry[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    if (!samePoint(a, b)) out.push(line(a, b))
  }
  return out
}

/** Split a simplified polyline at its corners — vertices that turn hard between two long-enough arms. */
export function splitAtCorners(points: readonly Vec2[], minArm: number): Vec2[][] {
  if (points.length < 3) return [[...points]]
  const limit = Math.cos((CORNER_DEGREES * Math.PI) / 180)
  const corners: number[] = []
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!
    const cur = points[i]!
    const next = points[i + 1]!
    const ax = cur.x - prev.x
    const ay = cur.y - prev.y
    const bx = next.x - cur.x
    const by = next.y - cur.y
    const la = Math.hypot(ax, ay)
    const lb = Math.hypot(bx, by)
    if (la < minArm || lb < minArm) continue
    const cos = (ax * bx + ay * by) / (la * lb)
    if (cos < limit) corners.push(i)
  }

  if (corners.length === 0) return [[...points]]
  const pieces: Vec2[][] = []
  let start = 0
  for (const c of corners) {
    pieces.push(points.slice(start, c + 1))
    start = c
  }
  pieces.push(points.slice(start))
  return pieces.filter((p) => p.length >= 2)
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9
}
