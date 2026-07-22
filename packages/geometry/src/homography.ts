import { isZero } from './epsilon'
import { vec2, type Vec2 } from './vec2'

/**
 * A 2D projective transform (homography), stored row-major as nine numbers
 *
 * ```
 * | m0 m1 m2 |     X = m0·x + m1·y + m2
 * | m3 m4 m5 | ,   Y = m3·x + m4·y + m5
 * | m6 m7 m8 |     W = m6·x + m7·y + m8   →   (X/W, Y/W)
 * ```
 *
 * Unlike {@link Transform2D} (affine, bottom row `0 0 1`), the bottom row is free, so a
 * homography can map any convex quad to any convex quad — the perspective correction
 * F-051 needs to rectify a photographed rectangle. Plain data; composed with
 * {@link multiplyMat3}. The same matrix is handed to the WebGL underlay shader (as a
 * `mat3` uniform) so on-GPU sampling matches on-CPU measurement exactly.
 */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number]

/** Four corners of a quad, in TL, TR, BR, BL order. */
export type Quad = readonly [Vec2, Vec2, Vec2, Vec2]

export const IDENTITY_MAT3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** Map a point through a homography, dividing out the homogeneous coordinate. */
export function applyHomography(m: Mat3, p: Vec2): Vec2 {
  const w = m[6] * p.x + m[7] * p.y + m[8]
  // A finite point never maps to infinity for the convex-quad homographies we build; guard
  // anyway so a degenerate matrix yields a sane (origin) point rather than NaN.
  if (isZero(w)) return vec2(0, 0)
  return vec2((m[0] * p.x + m[1] * p.y + m[2]) / w, (m[3] * p.x + m[4] * p.y + m[5]) / w)
}

/** Matrix product `a · b` (apply `b` first, then `a`), row-major. */
export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const out: number[] = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out.push(
        a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!,
      )
    }
  }
  return out as unknown as Mat3
}

/** Inverse of a 3×3 matrix. Returns {@link IDENTITY_MAT3} if the matrix is singular. */
export function invertMat3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (isZero(det)) return IDENTITY_MAT3
  const inv = 1 / det
  return [
    A * inv,
    (c * h - b * i) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    (c * d - a * f) * inv,
    C * inv,
    (b * g - a * h) * inv,
    (a * e - b * d) * inv,
  ]
}

/**
 * The homography that maps four source points to four destination points exactly. Solves
 * the eight-unknown linear system (`h8` fixed to 1) by Gaussian elimination with partial
 * pivoting. Points must be in general position (no three collinear, i.e. a proper convex
 * quad); a degenerate configuration falls back to {@link IDENTITY_MAT3}.
 */
export function homographyFromQuadToQuad(src: Quad, dst: Quad): Mat3 {
  const n = 8
  const cols = n + 1
  // Augmented matrix [A | b], row-major in a Float64Array so element access is a plain number.
  // For each correspondence (x,y) → (u,v):
  //   h0·x + h1·y + h2 − h6·x·u − h7·y·u = u
  //   h3·x + h4·y + h5 − h6·x·v − h7·y·v = v
  const m = new Float64Array(n * cols)
  for (let k = 0; k < 4; k++) {
    const { x, y } = src[k]!
    const { x: u, y: v } = dst[k]!
    const r0 = 2 * k * cols
    m[r0] = x
    m[r0 + 1] = y
    m[r0 + 2] = 1
    m[r0 + 6] = -x * u
    m[r0 + 7] = -y * u
    m[r0 + 8] = u
    const r1 = (2 * k + 1) * cols
    m[r1 + 3] = x
    m[r1 + 4] = y
    m[r1 + 5] = 1
    m[r1 + 6] = -x * v
    m[r1 + 7] = -y * v
    m[r1 + 8] = v
  }
  const h = solve(m, n, cols)
  if (!h) return IDENTITY_MAT3
  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1]
}

/** Solve the augmented dense system `m` (n×(n+1)) by Gaussian elimination with partial pivoting. */
function solve(m: Float64Array, n: number, cols: number): Float64Array | null {
  for (let col = 0; col < n; col++) {
    // Partial pivot: find the row with the largest magnitude in this column.
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row * cols + col]!) > Math.abs(m[pivot * cols + col]!)) pivot = row
    }
    if (isZero(m[pivot * cols + col]!)) return null
    if (pivot !== col) {
      for (let c = 0; c < cols; c++) {
        const tmp = m[col * cols + c]!
        m[col * cols + c] = m[pivot * cols + c]!
        m[pivot * cols + c] = tmp
      }
    }
    // Eliminate below.
    for (let row = col + 1; row < n; row++) {
      const factor = m[row * cols + col]! / m[col * cols + col]!
      if (factor === 0) continue
      for (let c = col; c < cols; c++) {
        m[row * cols + c] = m[row * cols + c]! - factor * m[col * cols + c]!
      }
    }
  }
  // Back-substitution.
  const x = new Float64Array(n)
  for (let row = n - 1; row >= 0; row--) {
    let sum = m[row * cols + n]!
    for (let col = row + 1; col < n; col++) sum -= m[row * cols + col]! * x[col]!
    x[row] = sum / m[row * cols + row]!
  }
  return x
}
