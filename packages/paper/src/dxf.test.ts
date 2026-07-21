import { arc, cubic, line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { buildDxf } from './dxf'
import type { ExportScene } from './exportScene'

const OPTS = { projectName: 'Test', includeCut: true }

/** Parse a DXF string into ordered [groupCode, value] pairs for structural assertions. */
function pairs(dxf: string): Array<[number, string]> {
  const lines = dxf.split('\n')
  const out: Array<[number, string]> = []
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([Number(lines[i]), lines[i + 1]!])
  return out
}

/** All entity type names (group code 0) inside the ENTITIES section. */
function entityTypes(dxf: string): string[] {
  const ps = pairs(dxf)
  const start = ps.findIndex(([c, v]) => c === 2 && v === 'ENTITIES')
  const types: string[] = []
  for (let i = start; i < ps.length; i++) {
    const [c, v] = ps[i]!
    if (c === 0 && v === 'ENDSEC') break
    if (c === 0 && v !== 'SECTION') types.push(v)
  }
  return types
}

/** The value following the first occurrence of a given [code,value] anchor's sibling code. */
function valueAfter(
  dxf: string,
  anchorCode: number,
  anchorValue: string,
  wantCode: number,
): string {
  const ps = pairs(dxf)
  const idx = ps.findIndex(([c, v]) => c === anchorCode && v === anchorValue)
  for (let i = idx + 1; i < ps.length; i++) {
    if (ps[i]![0] === wantCode) return ps[i]![1]
  }
  throw new Error(`code ${wantCode} not found after ${anchorCode}/${anchorValue}`)
}

function scene(): ExportScene {
  return {
    contentBounds: { min: vec2(0, 0), max: vec2(100, 100) },
    segments: [
      { id: 's1', geometry: line(vec2(0, 0), vec2(100, 0)), role: 'border', widthMm: 2 },
      { id: 's2', geometry: line(vec2(20, 0), vec2(20, 100)), role: 'lead', widthMm: 1 },
    ],
    pieces: [
      {
        key: 'A1',
        ring: [vec2(0, 0), vec2(20, 0), vec2(20, 100), vec2(0, 100)],
        holeRings: [],
        cutRing: [vec2(1, 1), vec2(19, 1), vec2(19, 99), vec2(1, 99)],
        cutHoleRings: [],
        label: 'A1',
      },
    ],
    reinforcements: [{ a: vec2(0, 50), b: vec2(100, 50), widthMm: 6 }],
    legend: [],
  }
}

describe('buildDxf', () => {
  it('is a valid R12 metric drawing with a layer table', () => {
    const dxf = buildDxf(scene(), OPTS)
    expect(valueAfter(dxf, 9, '$ACADVER', 1)).toBe('AC1009')
    expect(valueAfter(dxf, 9, '$INSUNITS', 70)).toBe('4')
    expect(dxf).toContain('EOF')
    // Only the layers actually used appear.
    const layerNames = pairs(dxf)
      .filter(([c]) => c === 2)
      .map(([, v]) => v)
    expect(layerNames).toEqual(expect.arrayContaining(['LEAD', 'BORDER', 'CUT', 'REBAR']))
  })

  it('places entities on the right layers', () => {
    const dxf = buildDxf(scene(), OPTS)
    const ps = pairs(dxf)
    // The rebar is a LINE on REBAR.
    const rebarLine = ps.findIndex(
      ([c, v], i) => c === 0 && v === 'LINE' && ps[i + 1]?.[1] === 'REBAR',
    )
    expect(rebarLine).toBeGreaterThanOrEqual(0)
    // The cut contour is a closed POLYLINE on CUT.
    expect(dxf).toContain('POLYLINE')
    expect(entityTypes(dxf)).toContain('POLYLINE')
  })

  it('emits arcs as ARC entities with y-up flipped angles (FR-3)', () => {
    const arcScene: ExportScene = {
      contentBounds: { min: vec2(0, 0), max: vec2(100, 100) },
      segments: [
        { id: 'a1', geometry: arc(vec2(0, 0), 10, 0, Math.PI / 2, true), role: 'lead', widthMm: 1 },
      ],
      pieces: [],
      reinforcements: [],
      legend: [],
    }
    const dxf = buildDxf(arcScene, OPTS)
    expect(entityTypes(dxf)).toContain('ARC')
    // Centre flipped about y (flipC = 0 + 100 = 100): (0,0) → (0,100).
    expect(valueAfter(dxf, 0, 'ARC', 10)).toBe('0') // centre x
    expect(valueAfter(dxf, 0, 'ARC', 20)).toBe('100') // centre y
    expect(valueAfter(dxf, 0, 'ARC', 40)).toBe('10') // radius
    // World CCW arc becomes CW after the flip; DXF (always CCW) swaps endpoints: 270° → 0°.
    expect(Number(valueAfter(dxf, 0, 'ARC', 50))).toBeCloseTo(270, 4)
    expect(Number(valueAfter(dxf, 0, 'ARC', 51))).toBeCloseTo(0, 4)
  })

  it('flattens cubic béziers to open polylines (documented tolerance)', () => {
    const cubicScene: ExportScene = {
      contentBounds: { min: vec2(0, 0), max: vec2(100, 100) },
      segments: [
        {
          id: 'c1',
          geometry: cubic(vec2(0, 0), vec2(0, 60), vec2(60, 60), vec2(60, 0)),
          role: 'lead',
          widthMm: 1,
        },
      ],
      pieces: [],
      reinforcements: [],
      legend: [],
    }
    const dxf = buildDxf(cubicScene, OPTS)
    expect(entityTypes(dxf)).toContain('POLYLINE')
    // An open polyline (flag 0), with several vertices from subdivision.
    expect(valueAfter(dxf, 0, 'POLYLINE', 70)).toBe('0')
    const vertexCount = (dxf.match(/\nVERTEX\n/g) ?? []).length
    expect(vertexCount).toBeGreaterThan(2)
  })

  it('omits the cut layer when includeCut is false', () => {
    const dxf = buildDxf(scene(), { ...OPTS, includeCut: false })
    const layerNames = pairs(dxf)
      .filter(([c]) => c === 2)
      .map(([, v]) => v)
    expect(layerNames).not.toContain('CUT')
  })

  it('is deterministic and order-independent (FR-4)', () => {
    const a = buildDxf(scene(), OPTS)
    expect(buildDxf(scene(), OPTS)).toBe(a)
    const s = scene()
    const shuffled: ExportScene = { ...s, segments: [...s.segments].reverse() }
    expect(buildDxf(shuffled, OPTS)).toBe(a)
  })
})
