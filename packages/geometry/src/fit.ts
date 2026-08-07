import { cubicPointAt, cubicVelocity, cubicAcceleration } from './cubicmath'
import { cubic, type CubicBezier } from './types'
import { add, distance, dot, normalize, scale, sub, type Vec2 } from './vec2'

/**
 * Fitting cubic béziers to a sampled polyline — Philip Schneider's algorithm (Graphics Gems, 1990),
 * the classic "fit a curve to digitised points" method. F-010 gave the kernel every way to *evaluate*
 * a cubic; this is the inverse, and F-059's autotrace needs it: a skeletonised pencil stroke arrives
 * as a dense run of pixel centres and has to become a handful of editable spans.
 *
 * The method: chord-length parameterise the run, estimate unit tangents at its ends, solve the
 * least-squares control points (Wu/Barsky), then refine the parameterisation by Newton–Raphson. If
 * the worst point is still further than `tol` from the curve, split there — with a tangent estimated
 * from the neighbourhood — and fit each half. So the output is the fewest spans that hold the
 * tolerance, and consecutive spans share an endpoint exactly (a welded chain by construction).
 *
 * Deterministic: no randomness, no set/map iteration, fixed iteration counts — the same points and
 * tolerance always give the same curves (F-059 FR-6 depends on this).
 */

/**
 * How many Newton–Raphson reparameterisation passes to run before giving up and splitting.
 *
 * Schneider only reparameterises when the fit is already within `tol²`, which makes him split often.
 * A traced skeleton run is long and its chord-length parameterisation can be badly off (several mm on
 * a 100 mm S-curve), so we always reparameterise, and stop early the moment a pass fails to improve.
 * The payoff is far fewer, longer spans — which is what an editable trace wants.
 */
const REPARAM_PASSES = 12

/** Depth guard: a pathological run cannot recurse forever (2^12 spans is far past useful). */
const MAX_DEPTH = 12

/**
 * Fit a chain of cubic béziers to `points` so no point lies further than `tol` from the chain.
 *
 * Returns an empty array for fewer than two points. Two points give a single degenerate-handle
 * cubic along the chord (callers that want a straight line should detect that case themselves —
 * see `isNearlyStraight`).
 */
export function fitCubics(points: readonly Vec2[], tol: number): CubicBezier[] {
  if (tol < 0) throw new Error('fitCubics: tolerance must be \u2265 0')
  const pts = dedupe(points)
  if (pts.length < 2) return []
  if (pts.length === 2) return [chordCubic(pts[0]!, pts[1]!)]
  const out: CubicBezier[] = []
  // A closed run (a traced circle) has no chord to fit along and no end tangents to estimate: cut it
  // in half first, so each half is an ordinary open run. Autotrace produces these routinely.
  if (pts.length >= 5 && distance(pts[0]!, pts[pts.length - 1]!) <= 1e-9) {
    const mid = Math.floor(pts.length / 2)
    fitOpen(pts.slice(0, mid + 1), tol, out)
    fitOpen(pts.slice(mid), tol, out)
    return out
  }
  fitOpen(pts, tol, out)
  return out
}

/** Fit one open run: estimate its end tangents, then recurse. */
function fitOpen(pts: readonly Vec2[], tol: number, out: CubicBezier[]): void {
  if (pts.length < 2) return
  if (pts.length === 2) {
    out.push(chordCubic(pts[0]!, pts[1]!))
    return
  }
  const tHat1 = normalize(sub(pts[1]!, pts[0]!))
  const tHat2 = normalize(sub(pts[pts.length - 2]!, pts[pts.length - 1]!))
  fitRun(pts, 0, pts.length - 1, tHat1, tHat2, tol, 0, out)
}

/**
 * Whether every point lies within `tol` of the straight chord from the first to the last — i.e. the
 * run is a line, not a curve. Autotrace uses this to keep drawn straight lines as `Line` segments
 * rather than fitting a cubic to them.
 */
export function isNearlyStraight(points: readonly Vec2[], tol: number): boolean {
  if (points.length < 3) return true
  const a = points[0]!
  const b = points[points.length - 1]!
  const ab = sub(b, a)
  const len = Math.hypot(ab.x, ab.y)
  if (len < 1e-12) {
    // A closed run: straight only if it collapses to a point.
    return points.every((p) => distance(p, a) <= tol)
  }
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!
    const d = Math.abs(ab.x * (p.y - a.y) - ab.y * (p.x - a.x)) / len
    if (d > tol) return false
  }
  return true
}

/** Drop consecutive duplicate points, which would give a zero-length chord and a NaN tangent. */
function dedupe(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of points) {
    const prev = out[out.length - 1]
    if (!prev || distance(prev, p) > 1e-9) out.push(p)
  }
  return out
}

/** A cubic along the chord `a`→`b` with handles at the thirds (the two-point degenerate case). */
function chordCubic(a: Vec2, b: Vec2): CubicBezier {
  const d = scale(sub(b, a), 1 / 3)
  return cubic(a, add(a, d), sub(b, d), b)
}

function fitRun(
  pts: readonly Vec2[],
  first: number,
  last: number,
  tHat1: Vec2,
  tHat2: Vec2,
  tol: number,
  depth: number,
  out: CubicBezier[],
): void {
  const n = last - first + 1
  if (n === 2) {
    out.push(chordCubic(pts[first]!, pts[last]!))
    return
  }

  let u = chordLengthParameterize(pts, first, last)
  let curve = generateBezier(pts, first, last, u, tHat1, tHat2)
  let { error, index } = maxError(pts, first, last, curve, u)

  for (let pass = 0; pass < REPARAM_PASSES && error > tol; pass++) {
    const nextU = reparameterize(pts, first, last, u, curve)
    const nextCurve = generateBezier(pts, first, last, nextU, tHat1, tHat2)
    const next = maxError(pts, first, last, nextCurve, nextU)
    // Keep the better of the two: a pass that stops improving means Newton has converged.
    if (!(next.error < error - 1e-12)) break
    u = nextU
    curve = nextCurve
    error = next.error
    index = next.index
  }

  if (error <= tol || depth >= MAX_DEPTH) {
    out.push(curve)
    return
  }

  // Split at the worst point, with a tangent from its neighbours so the two halves join smoothly.
  const split = Math.min(Math.max(index, first + 1), last - 1)
  const centre = centreTangent(pts, split)
  fitRun(pts, first, split, tHat1, centre, tol, depth + 1, out)
  fitRun(pts, split, last, negated(centre), tHat2, tol, depth + 1, out)
}

function negated(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y }
}

/** Unit tangent at an interior point, from the chord between its neighbours. */
function centreTangent(pts: readonly Vec2[], i: number): Vec2 {
  const prev = pts[i - 1]!
  const next = pts[i + 1]!
  const v = sub(prev, next)
  const len = Math.hypot(v.x, v.y)
  if (len < 1e-12) return { x: 1, y: 0 }
  return { x: v.x / len, y: v.y / len }
}

/** Parameter values in [0,1] proportional to accumulated chord length. */
function chordLengthParameterize(pts: readonly Vec2[], first: number, last: number): number[] {
  const u: number[] = [0]
  for (let i = first + 1; i <= last; i++) {
    u.push(u[i - first - 1]! + distance(pts[i]!, pts[i - 1]!))
  }
  const total = u[u.length - 1]!
  if (total <= 0) return u.map((_, i) => i / (u.length - 1))
  return u.map((v) => v / total)
}

/** Total polyline length of the run. */
function runLength(pts: readonly Vec2[], first: number, last: number): number {
  let total = 0
  for (let i = first + 1; i <= last; i++) total += distance(pts[i]!, pts[i - 1]!)
  return total
}

const B0 = (t: number): number => (1 - t) ** 3
const B1 = (t: number): number => 3 * t * (1 - t) ** 2
const B2 = (t: number): number => 3 * t * t * (1 - t)
const B3 = (t: number): number => t ** 3

/**
 * Least-squares control points for the run, with the end tangents fixed (Wu/Barsky). Solves the 2×2
 * normal equations for the two handle lengths; a singular/negative solution falls back to Schneider's
 * heuristic of one third of the chord.
 */
function generateBezier(
  pts: readonly Vec2[],
  first: number,
  last: number,
  u: readonly number[],
  tHat1: Vec2,
  tHat2: Vec2,
): CubicBezier {
  const p0 = pts[first]!
  const p3 = pts[last]!
  const n = last - first + 1

  let c00 = 0
  let c01 = 0
  let c11 = 0
  let x0 = 0
  let x1 = 0

  for (let i = 0; i < n; i++) {
    const t = u[i]!
    const a1 = scale(tHat1, B1(t))
    const a2 = scale(tHat2, B2(t))
    c00 += dot(a1, a1)
    c01 += dot(a1, a2)
    c11 += dot(a2, a2)
    const onCurve = add(scale(p0, B0(t) + B1(t)), scale(p3, B2(t) + B3(t)))
    const tmp = sub(pts[first + i]!, onCurve)
    x0 += dot(a1, tmp)
    x1 += dot(a2, tmp)
  }

  const det = c00 * c11 - c01 * c01
  let alpha1 = 0
  let alpha2 = 0
  if (Math.abs(det) > 1e-12) {
    alpha1 = (c11 * x0 - c01 * x1) / det
    alpha2 = (c00 * x1 - c01 * x0) / det
  }

  // Fall back on the run's own length, not the chord: a nearly-closed run has a chord of ~0 and
  // would otherwise get zero-length handles (a degenerate curve that no amount of splitting fixes).
  const chord = Math.max(distance(p0, p3), runLength(pts, first, last) / 3)
  const epsilon = 1e-6 * chord
  if (!(alpha1 > epsilon) || !(alpha2 > epsilon)) {
    const third = chord / 3
    alpha1 = third
    alpha2 = third
  }

  return cubic(p0, add(p0, scale(tHat1, alpha1)), add(p3, scale(tHat2, alpha2)), p3)
}

/**
 * One Newton–Raphson pass moving each parameter to the closest point on the curve, kept **strictly
 * increasing**. Without that guard Newton happily collapses neighbouring parameters onto the same
 * value (or pins them at 0/1) on a long run: the least-squares fit then optimises against a
 * degenerate parameterisation and the reported error drops while the curve drifts away from the
 * points — the fit looks converged and is not.
 */
function reparameterize(
  pts: readonly Vec2[],
  first: number,
  last: number,
  u: readonly number[],
  curve: CubicBezier,
): number[] {
  const n = last - first + 1
  const gap = 1e-9
  const out: number[] = [0]
  for (let i = 1; i < n - 1; i++) {
    const t = newtonStep(curve, pts[first + i]!, u[i]!)
    const lower = out[i - 1]! + gap
    const upper = 1 - (n - 1 - i) * gap
    out.push(Math.min(Math.max(t, lower), Math.max(lower, upper)))
  }
  out.push(1)
  return out
}

/** Newton–Raphson root of `(Q(t) − p) · Q'(t) = 0`, clamped so the parameter stays in [0,1]. */
function newtonStep(curve: CubicBezier, p: Vec2, t: number): number {
  const q = cubicPointAt(curve, t)
  const d1 = cubicVelocity(curve, t)
  const d2 = cubicAcceleration(curve, t)
  const diff = sub(q, p)
  const numerator = dot(diff, d1)
  const denominator = dot(d1, d1) + dot(diff, d2)
  if (Math.abs(denominator) < 1e-12) return t
  const next = t - numerator / denominator
  return Number.isFinite(next) ? Math.min(1, Math.max(0, next)) : t
}

/** The furthest point from the fitted curve, and where it is. */
function maxError(
  pts: readonly Vec2[],
  first: number,
  last: number,
  curve: CubicBezier,
  u: readonly number[],
): { error: number; index: number } {
  let error = 0
  let index = first + Math.floor((last - first + 1) / 2)
  for (let i = 1; i < last - first; i++) {
    const d = distance(cubicPointAt(curve, u[i]!), pts[first + i]!)
    if (d > error) {
      error = d
      index = first + i
    }
  }
  return { error, index }
}
