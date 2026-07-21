import { parseSvg, type PathGeometry } from '@vitrum/core'
import { arcPointAt, cubicPointAt, lerp, vec2, arc, cubic, line, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import type { ExportScene, ExportSegment } from './exportScene'
import { buildSvg } from './svg'

/**
 * The **linework-SVG round-trip contract** (F-043 ↔ F-050, FR-4), owned jointly by export and SVG
 * import. Exporting the lead-line network as linework SVG and re-importing it must reproduce the
 * network. This test drives the **real F-050 importer** (`@vitrum/core`'s `parseSvg`) — so a wrong
 * sweep flag or large-arc flag on the export side, or a parsing bug on the import side, is caught by
 * the sampled-point comparison below. Circular arcs must reconstruct exactly as kernel arcs (the
 * importer's lossless-round-trip path), which is what keeps "same segments, same geometry" true.
 */

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
  return arcPointAt(g, t)
}

function sampleParsed(g: PathGeometry, t: number): Vec2 {
  if (g.kind === 'line') return lerp(g.a, g.b, t)
  if (g.kind === 'cubic') return cubicPointAt(g, t)
  return arcPointAt(g, t)
}

function samplesMatch(seg: ExportSegment, parsed: PathGeometry): void {
  for (let k = 0; k <= 8; k++) {
    const t = k / 8
    const original = sampleOriginal(seg, t)
    const got = sampleParsed(parsed, t)
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
    const parsed = parseSvg(svg).geometries
    expect(parsed).toHaveLength(segments.length)

    // Export orders segments by id and groups lead before border; the source here sorts the same way.
    const sorted = [...segments].sort((x, y) => (x.id < y.id ? -1 : 1))
    sorted.forEach((seg, idx) => samplesMatch(seg, parsed[idx]!))
  })

  it('reconstructs circular arcs as kernel arcs (not cubics), so the network is byte-preserved', () => {
    const segments: ExportSegment[] = [
      { id: 'c', geometry: arc(vec2(20, 20), 15, 0, Math.PI / 2, true), role: 'lead', widthMm: 1 },
    ]
    const parsed = parseSvg(buildSvg(lineworkScene(segments), OPTS)).geometries
    expect(parsed[0]!.kind).toBe('arc')
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
