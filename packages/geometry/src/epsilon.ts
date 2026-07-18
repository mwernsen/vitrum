/**
 * Numerical hygiene for the whole kernel (F-010 FR: "a single documented epsilon
 * strategy used consistently").
 *
 * Vitrum works in millimetres, so tolerances are **absolute distances in mm**, not
 * relative. `EPS` is the smallest distance two points may differ by and still be
 * considered coincident. At real panel scale (tens to thousands of mm) 1e-6 mm is a
 * nanometre — far below anything a cutter or printer can resolve — while staying well
 * above IEEE-754 double noise, so comparisons are stable without being sloppy.
 *
 * Everything downstream (intersection classification, offset joins, simplify) routes
 * its "are these equal?" decisions through these helpers. Do not hand-roll `Math.abs(a
 * - b) < 0.001` at call sites — thread it through here so the tolerance is tunable in
 * one place.
 */

/** Absolute distance tolerance in millimetres. */
export const EPS = 1e-6

/** Angular tolerance in radians, used when comparing tangent directions. */
export const ANGLE_EPS = 1e-9

/** Are two scalars equal within `tol`? */
export function eq(a: number, b: number, tol = EPS): boolean {
  return Math.abs(a - b) <= tol
}

/** Is a scalar zero within `tol`? */
export function isZero(a: number, tol = EPS): boolean {
  return Math.abs(a) <= tol
}

/** Clamp `x` into the closed interval `[lo, hi]`. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/** Clamp a curve parameter into `[0, 1]`, absorbing tiny overshoots from solvers. */
export function clamp01(t: number): number {
  return clamp(t, 0, 1)
}
