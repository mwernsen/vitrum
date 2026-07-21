import {
  arcPointAt,
  cubicPointAt,
  lerp,
  vec2,
  arc,
  cubic,
  line,
  type Arc,
  type CubicBezier,
  type Line,
  type Vec2,
} from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import type { ExportScene, ExportSegment } from './exportScene'
import { buildSvg } from './svg'

/**
 * The **linework-SVG round-trip contract** (F-043 ↔ F-050), owned jointly by export and SVG import.
 * Exporting the lead-line network as linework SVG and importing it back must reproduce the network.
 *
 * F-050 (SVG import) is not built yet, so the "import" side here is a minimal path parser local to
 * this test. When F-050 lands it replaces `parseLineworkSvg` with the real importer and keeps this
 * contract as the shared regression: same segments in, geometrically-equivalent segments out. The
 * parser deliberately implements the standard SVG endpoint→centre arc conversion (W3C SVG 1.1 F.6.5)
 * so that a wrong sweep flag or large-arc flag on the export side is caught by the sampled-point
 * comparison below.
 */

type ParsedSegment =
  | { readonly kind: 'line'; readonly geometry: Line }
  | { readonly kind: 'cubic'; readonly geometry: CubicBezier }
  | { readonly kind: 'arc'; readonly sample: (t: number) => Vec2 }

/** Parse the `d` attributes of a linework SVG into samplable segments. One subpath per segment. */
function parseLineworkSvg(svg: string): ParsedSegment[] {
  const out: ParsedSegment[] = []
  const dRe = /<path[^>]*\bd="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = dRe.exec(svg)) !== null) out.push(parsePathD(m[1]!))
  return out
}

function parsePathD(d: string): ParsedSegment {
  const tokens = d.match(/[MLCAZmlcaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? []
  let i = 0
  const nextNum = (): number => Number(tokens[i++])
  let cur: Vec2 = vec2(0, 0)
  let start: Vec2 = vec2(0, 0)
  let result: ParsedSegment | null = null
  while (i < tokens.length) {
    const cmd = tokens[i++]
    if (cmd === 'M') {
      cur = vec2(nextNum(), nextNum())
      start = cur
    } else if (cmd === 'L') {
      const b = vec2(nextNum(), nextNum())
      result = { kind: 'line', geometry: line(start, b) }
      cur = b
    } else if (cmd === 'C') {
      const p1 = vec2(nextNum(), nextNum())
      const p2 = vec2(nextNum(), nextNum())
      const p3 = vec2(nextNum(), nextNum())
      result = { kind: 'cubic', geometry: cubic(start, p1, p2, p3) }
      cur = p3
    } else if (cmd === 'A') {
      const rx = nextNum()
      const ry = nextNum()
      nextNum() // x-axis rotation (always 0 here)
      const large = nextNum()
      const sweep = nextNum()
      const end = vec2(nextNum(), nextNum())
      const sample = svgArcSampler(cur, end, rx, ry, large === 1, sweep === 1)
      result = { kind: 'arc', sample }
      cur = end
    } else {
      // Z or a bare number token; ignore.
    }
  }
  if (!result) throw new Error(`no drawable command in "${d}"`)
  return result
}

/** Standard SVG endpoint→centre arc parameterisation (rotation 0), returning a t↦point sampler. */
function svgArcSampler(
  p1: Vec2,
  p2: Vec2,
  rx: number,
  ry: number,
  fa: boolean,
  fs: boolean,
): (t: number) => Vec2 {
  const x1p = (p1.x - p2.x) / 2
  const y1p = (p1.y - p2.y) / 2
  const rx2 = rx * rx
  const ry2 = ry * ry
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p
  const sign = fa !== fs ? 1 : -1
  const coef = sign * Math.sqrt(Math.max(0, num / den))
  const cxp = (coef * (rx * y1p)) / ry
  const cyp = (coef * -(ry * x1p)) / rx
  const cx = cxp + (p1.x + p2.x) / 2
  const cy = cyp + (p1.y + p2.y) / 2
  const ux = (x1p - cxp) / rx
  const uy = (y1p - cyp) / ry
  const vx = (-x1p - cxp) / rx
  const vy = (-y1p - cyp) / ry
  const theta1 = Math.atan2(uy, ux)
  let delta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  if (!fs && delta > 0) delta -= 2 * Math.PI
  if (fs && delta < 0) delta += 2 * Math.PI
  return (t: number) => {
    const a = theta1 + delta * t
    return vec2(cx + rx * Math.cos(a), cy + ry * Math.sin(a))
  }
}

function lineworkScene(segments: readonly ExportSegment[]): ExportScene {
  return {
    contentBounds: { min: vec2(-50, -50), max: vec2(150, 150) },
    segments,
    pieces: [],
    reinforcements: [],
    legend: [],
  }
}

const OPTS = {
  flavor: 'linework' as const,
  cutLayout: 'in-place' as const,
  includeNumbers: false,
  projectName: 'round-trip',
}

function sampleOriginal(seg: ExportSegment, t: number): Vec2 {
  const g = seg.geometry
  if (g.kind === 'line') return lerp(g.a, g.b, t)
  if (g.kind === 'cubic') return cubicPointAt(g, t)
  return arcPointAt(g as Arc, t)
}

function samplesMatch(seg: ExportSegment, parsed: ParsedSegment): void {
  for (let k = 0; k <= 8; k++) {
    const t = k / 8
    const original = sampleOriginal(seg, t)
    let got: Vec2
    if (parsed.kind === 'arc') got = parsed.sample(t)
    else if (parsed.kind === 'cubic') got = cubicPointAt(parsed.geometry, t)
    else got = lerp(parsed.geometry.a, parsed.geometry.b, t)
    expect(got.x).toBeCloseTo(original.x, 6)
    expect(got.y).toBeCloseTo(original.y, 6)
  }
}

describe('linework SVG round-trip contract (F-043 ↔ F-050)', () => {
  it('reproduces line, cubic and arc segments (minor and major, both directions)', () => {
    const segments: ExportSegment[] = [
      { id: 'a', geometry: line(vec2(0, 0), vec2(100, 40)), role: 'lead', widthMm: 1 },
      {
        id: 'b',
        geometry: cubic(vec2(0, 0), vec2(10, 60), vec2(70, 60), vec2(80, 0)),
        role: 'lead',
        widthMm: 1,
      },
      // 90° arc, CCW.
      { id: 'c', geometry: arc(vec2(20, 20), 15, 0, Math.PI / 2, true), role: 'lead', widthMm: 1 },
      // 270° arc (large-arc), CCW.
      {
        id: 'd',
        geometry: arc(vec2(60, 60), 12, 0, (3 * Math.PI) / 2, true),
        role: 'lead',
        widthMm: 1,
      },
      // 90° arc, CW (sweep flag 0).
      {
        id: 'e',
        geometry: arc(vec2(100, 20), 10, Math.PI / 2, 0, false),
        role: 'border',
        widthMm: 2,
      },
    ]
    const svg = buildSvg(lineworkScene(segments), OPTS)
    const parsed = parseLineworkSvg(svg)
    expect(parsed).toHaveLength(segments.length)

    // Match parsed subpaths to source segments by their start point (order is id-sorted, stable).
    const sorted = [...segments].sort((x, y) => (x.id < y.id ? -1 : 1))
    sorted.forEach((seg, idx) => samplesMatch(seg, parsed[idx]!))
  })

  it('preserves segment roles as group classes', () => {
    const svg = buildSvg(
      lineworkScene([
        { id: 'x', geometry: line(vec2(0, 0), vec2(10, 0)), role: 'lead', widthMm: 1 },
        { id: 'y', geometry: line(vec2(0, 0), vec2(0, 10)), role: 'border', widthMm: 2 },
      ]),
      OPTS,
    )
    expect(svg).toContain('data-role="lead"')
    expect(svg).toContain('data-role="border"')
  })
})
