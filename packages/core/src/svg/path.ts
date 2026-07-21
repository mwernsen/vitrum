import {
  arc,
  cubic,
  eq,
  line,
  vec2,
  type Arc,
  type CubicBezier,
  type Line,
  type Vec2,
} from '@vitrum/geometry'

/** The geometry an SVG path command becomes: a straight line, a circular arc, or a cubic Bézier. */
export type PathGeometry = Line | Arc | CubicBezier

/**
 * Parse an SVG path `d` attribute into a flat list of geometries in the path's own user coordinate
 * space (F-050). All command forms are supported — `M m L l H h V v C c S s Q q T t A a Z z`,
 * absolute and relative, with the shorthand smooth/quadratic reflections and implicit repeated
 * commands (`M` followed by extra coordinate pairs behaves as `L`).
 *
 * Curve mapping follows F-010's kernel vocabulary:
 * - quadratic Béziers are elevated to cubics (exact),
 * - an SVG elliptical arc that is **circular** (equal radii, no x-axis rotation) is reconstructed as
 *   a kernel {@link Arc} exactly — this is what makes the F-043 linework round-trip lossless (FR-4),
 * - a genuinely elliptical arc is converted to a chain of cubic Béziers (F-010's resolved decision).
 *
 * `Z` closes the current subpath with a straight line back to its start (unless already coincident).
 */
export function parsePathData(d: string): PathGeometry[] {
  const scanner = new Scanner(d)
  const out: PathGeometry[] = []

  let current = vec2(0, 0)
  let subpathStart = vec2(0, 0)
  // Last cubic/quadratic control point, for the S/T smooth reflections.
  let lastCubicControl: Vec2 | null = null
  let lastQuadControl: Vec2 | null = null
  let prevCommand = ''

  const emit = (g: PathGeometry): void => {
    out.push(g)
  }

  while (!scanner.done()) {
    let command = scanner.command()
    if (command === '') break
    // An implicit repeat: after the first coordinate set of an M/m, further sets are L/l.
    if (command === 'repeat') {
      command = prevCommand === 'M' ? 'L' : prevCommand === 'm' ? 'l' : prevCommand
    }
    const rel = command === command.toLowerCase()
    const abs = (p: Vec2): Vec2 => (rel ? vec2(current.x + p.x, current.y + p.y) : p)

    switch (command.toUpperCase()) {
      case 'M': {
        const p = abs(scanner.point())
        current = p
        subpathStart = p
        lastCubicControl = lastQuadControl = null
        break
      }
      case 'L': {
        const p = abs(scanner.point())
        emit(line(current, p))
        current = p
        lastCubicControl = lastQuadControl = null
        break
      }
      case 'H': {
        const x = rel ? current.x + scanner.number() : scanner.number()
        const p = vec2(x, current.y)
        emit(line(current, p))
        current = p
        lastCubicControl = lastQuadControl = null
        break
      }
      case 'V': {
        const y = rel ? current.y + scanner.number() : scanner.number()
        const p = vec2(current.x, y)
        emit(line(current, p))
        current = p
        lastCubicControl = lastQuadControl = null
        break
      }
      case 'C': {
        const p1 = abs(scanner.point())
        const p2 = abs(scanner.point())
        const p3 = abs(scanner.point())
        emit(cubic(current, p1, p2, p3))
        current = p3
        lastCubicControl = p2
        lastQuadControl = null
        break
      }
      case 'S': {
        const p1 = reflect(current, lastCubicControl)
        const p2 = abs(scanner.point())
        const p3 = abs(scanner.point())
        emit(cubic(current, p1, p2, p3))
        current = p3
        lastCubicControl = p2
        lastQuadControl = null
        break
      }
      case 'Q': {
        const qc = abs(scanner.point())
        const end = abs(scanner.point())
        emit(quadToCubic(current, qc, end))
        current = end
        lastQuadControl = qc
        lastCubicControl = null
        break
      }
      case 'T': {
        const qc = reflect(current, lastQuadControl)
        const end = abs(scanner.point())
        emit(quadToCubic(current, qc, end))
        current = end
        lastQuadControl = qc
        lastCubicControl = null
        break
      }
      case 'A': {
        const rx = Math.abs(scanner.number())
        const ry = Math.abs(scanner.number())
        const xRot = scanner.number()
        const large = scanner.flag()
        const sweep = scanner.flag()
        const end = abs(scanner.point())
        for (const g of arcCommand(current, end, rx, ry, xRot, large, sweep)) emit(g)
        current = end
        lastCubicControl = lastQuadControl = null
        break
      }
      case 'Z': {
        if (!eq(current.x, subpathStart.x) || !eq(current.y, subpathStart.y)) {
          emit(line(current, subpathStart))
        }
        current = subpathStart
        lastCubicControl = lastQuadControl = null
        break
      }
      default:
        // Unknown command — stop rather than loop forever on malformed data.
        return out
    }
    prevCommand = command
  }
  return out
}

/** Reflect the previous control point about `current` for an S/T smooth continuation. */
function reflect(current: Vec2, previousControl: Vec2 | null): Vec2 {
  if (!previousControl) return current
  return vec2(2 * current.x - previousControl.x, 2 * current.y - previousControl.y)
}

/** Elevate a quadratic Bézier to an equivalent cubic (exact). */
function quadToCubic(p0: Vec2, qc: Vec2, p3: Vec2): CubicBezier {
  return cubic(
    p0,
    vec2(p0.x + (2 / 3) * (qc.x - p0.x), p0.y + (2 / 3) * (qc.y - p0.y)),
    vec2(p3.x + (2 / 3) * (qc.x - p3.x), p3.y + (2 / 3) * (qc.y - p3.y)),
    p3,
  )
}

const DEG = Math.PI / 180

/**
 * Convert one SVG elliptical-arc command (endpoint parameterisation, W3C SVG 1.1 F.6.5) into kernel
 * geometry. A circular arc (equal radii, no rotation) becomes one exact {@link Arc}; an elliptical
 * one becomes a chain of ≤90° cubic Béziers. A degenerate arc (zero radius or coincident endpoints)
 * degrades to a straight line, matching the SVG spec.
 */
export function arcCommand(
  p1: Vec2,
  p2: Vec2,
  rxIn: number,
  ryIn: number,
  xAxisRotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
): PathGeometry[] {
  if (rxIn === 0 || ryIn === 0 || (eq(p1.x, p2.x) && eq(p1.y, p2.y))) return [line(p1, p2)]

  const phi = xAxisRotationDeg * DEG
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  // Step 1: compute (x1', y1') — the endpoint midpoint in the rotated frame.
  const dx = (p1.x - p2.x) / 2
  const dy = (p1.y - p2.y) / 2
  const x1p = cosPhi * dx + sinPhi * dy
  const y1p = -sinPhi * dx + cosPhi * dy

  // Correct out-of-range radii (F.6.6).
  let rx = rxIn
  let ry = ryIn
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    rx *= s
    ry *= s
  }

  // Step 2: compute the centre in the rotated frame.
  const rx2 = rx * rx
  const ry2 = ry * ry
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p
  const sign = largeArc !== sweep ? 1 : -1
  const coef = sign * Math.sqrt(Math.max(0, num / den))
  const cxp = (coef * (rx * y1p)) / ry
  const cyp = (coef * -(ry * x1p)) / rx

  // Step 3: rotate the centre back to the user frame.
  const cx = cosPhi * cxp - sinPhi * cyp + (p1.x + p2.x) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (p1.y + p2.y) / 2

  // Step 4: start angle and sweep.
  const ux = (x1p - cxp) / rx
  const uy = (y1p - cyp) / ry
  const vx = (-x1p - cxp) / rx
  const vy = (-y1p - cyp) / ry
  const theta1 = Math.atan2(uy, ux)
  let dTheta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI

  // Circular and un-rotated ⇒ reconstruct the exact kernel arc (lossless round-trip target, FR-4).
  if (eq(rx, ry, 1e-9) && (eq(phi, 0, 1e-12) || eq(Math.abs(phi) % (2 * Math.PI), 0, 1e-9))) {
    return [arc(vec2(cx, cy), rx, theta1, theta1 + dTheta, dTheta > 0)]
  }

  return ellipticalArcToCubics(cx, cy, rx, ry, phi, theta1, dTheta)
}

/** Approximate an elliptical arc as a chain of ≤90° cubic Béziers. */
function ellipticalArcToCubics(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  phi: number,
  theta1: number,
  dTheta: number,
): CubicBezier[] {
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const point = (theta: number): Vec2 => {
    const x = rx * Math.cos(theta)
    const y = ry * Math.sin(theta)
    return vec2(cx + cosPhi * x - sinPhi * y, cy + sinPhi * x + cosPhi * y)
  }
  // Ellipse derivative wrt theta, in user space.
  const deriv = (theta: number): Vec2 => {
    const x = -rx * Math.sin(theta)
    const y = ry * Math.cos(theta)
    return vec2(cosPhi * x - sinPhi * y, sinPhi * x + cosPhi * y)
  }

  // ≤45° sub-arcs keep the cubic approximation of the ellipse well within kernel tolerance.
  const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 4) - 1e-9))
  const step = dTheta / segments
  const alpha = (4 / 3) * Math.tan(step / 4)
  const out: CubicBezier[] = []
  for (let i = 0; i < segments; i++) {
    const a0 = theta1 + step * i
    const a1 = theta1 + step * (i + 1)
    const p0 = point(a0)
    const p3 = point(a1)
    const d0 = deriv(a0)
    const d1 = deriv(a1)
    out.push(
      cubic(
        p0,
        vec2(p0.x + alpha * d0.x, p0.y + alpha * d0.y),
        vec2(p3.x - alpha * d1.x, p3.y - alpha * d1.y),
        p3,
      ),
    )
  }
  return out
}

/** A cursor over a path `d` string that reads commands, numbers, coordinate pairs and arc flags. */
class Scanner {
  readonly #s: string
  #i = 0

  constructor(s: string) {
    this.#s = s
  }

  done(): boolean {
    this.#skip()
    return this.#i >= this.#s.length
  }

  /**
   * Read the next command letter, or `'repeat'` when the cursor is at a fresh number (an implicit
   * repeat of the previous command). Returns `''` at end of input.
   */
  command(): string {
    this.#skip()
    if (this.#i >= this.#s.length) return ''
    const ch = this.#s[this.#i]!
    if (/[a-zA-Z]/.test(ch)) {
      this.#i++
      return ch
    }
    return 'repeat'
  }

  number(): number {
    this.#skip()
    const re = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/y
    re.lastIndex = this.#i
    const m = re.exec(this.#s)
    if (!m) throw new Error(`parsePathData: expected a number at index ${this.#i}`)
    this.#i = re.lastIndex
    return Number(m[0])
  }

  point(): Vec2 {
    const x = this.number()
    const y = this.number()
    return vec2(x, y)
  }

  /** Read a single-character `0`/`1` arc flag (SVG allows them packed with no separator). */
  flag(): boolean {
    this.#skip()
    const ch = this.#s[this.#i]
    if (ch !== '0' && ch !== '1') {
      throw new Error(`parsePathData: expected an arc flag (0/1) at index ${this.#i}`)
    }
    this.#i++
    return ch === '1'
  }

  /** Skip whitespace and commas between tokens. */
  #skip(): void {
    while (this.#i < this.#s.length && /[\s,]/.test(this.#s[this.#i]!)) this.#i++
  }
}
