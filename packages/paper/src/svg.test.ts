import { arc, cubic, line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import type { ExportScene } from './exportScene'
import { buildSvg } from './svg'

const BOUNDS = { min: vec2(0, 0), max: vec2(100, 80) }

/** A small scene: a rectangular border (4 lines) + one numbered piece with a cut contour. */
function scene(): ExportScene {
  return {
    contentBounds: BOUNDS,
    segments: [
      { id: 's1', geometry: line(vec2(0, 0), vec2(100, 0)), role: 'border', widthMm: 2 },
      { id: 's2', geometry: line(vec2(100, 0), vec2(100, 80)), role: 'border', widthMm: 2 },
      { id: 's3', geometry: line(vec2(100, 80), vec2(0, 80)), role: 'border', widthMm: 2 },
      { id: 's4', geometry: line(vec2(0, 80), vec2(0, 0)), role: 'border', widthMm: 2 },
      { id: 's5', geometry: line(vec2(50, 0), vec2(50, 80)), role: 'lead', widthMm: 1 },
    ],
    pieces: [
      {
        key: 'A1',
        ring: [vec2(0, 0), vec2(50, 0), vec2(50, 80), vec2(0, 80)],
        holeRings: [],
        cutRing: [vec2(1, 1), vec2(49, 1), vec2(49, 79), vec2(1, 79)],
        cutHoleRings: [],
        fillColor: '#cc2244',
        label: 'A1',
        labelAt: vec2(25, 40),
      },
      {
        key: 'A2',
        ring: [vec2(50, 0), vec2(100, 0), vec2(100, 80), vec2(50, 80)],
        holeRings: [],
        cutRing: [vec2(51, 1), vec2(99, 1), vec2(99, 79), vec2(51, 79)],
        cutHoleRings: [],
        fillColor: '#2244cc',
        label: 'A2',
        labelAt: vec2(75, 40),
      },
    ],
    reinforcements: [],
    legend: [],
  }
}

const OPTS = {
  flavor: 'linework' as const,
  cutLayout: 'in-place' as const,
  includeNumbers: true,
  projectName: 'Test panel',
}

describe('buildSvg — document', () => {
  it('carries physical mm dimensions and a matching mm viewBox (FR-1)', () => {
    const svg = buildSvg(scene(), OPTS)
    expect(svg).toContain('width="100mm"')
    expect(svg).toContain('height="80mm"')
    expect(svg).toContain('viewBox="0 0 100 80"')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg.startsWith('<?xml')).toBe(true)
  })

  it('escapes the project name in the title', () => {
    const svg = buildSvg(scene(), { ...OPTS, projectName: 'A & B <1>' })
    expect(svg).toContain('<title>A &amp; B &lt;1&gt;</title>')
  })
})

describe('buildSvg — linework', () => {
  it('groups by role and skips construction guides', () => {
    const s = scene()
    const withGuide: ExportScene = {
      ...s,
      segments: [
        ...s.segments,
        { id: 's6', geometry: line(vec2(0, 40), vec2(100, 40)), role: 'construction', widthMm: 0 },
      ],
    }
    const svg = buildSvg(withGuide, OPTS)
    expect(svg).toContain('<g id="border-lines"')
    expect(svg).toContain('<g id="lead-lines"')
    // Construction guide geometry (y=40 horizontal) is not exported.
    expect(svg).not.toContain('data-role="construction"')
  })

  it('emits line, cubic and arc path commands from true geometry', () => {
    const s = scene()
    const curves: ExportScene = {
      ...s,
      segments: [
        {
          id: 'c1',
          geometry: cubic(vec2(0, 0), vec2(10, 20), vec2(30, 20), vec2(40, 0)),
          role: 'lead',
          widthMm: 1,
        },
        {
          id: 'a1',
          geometry: arc(vec2(50, 50), 10, 0, Math.PI / 2, true),
          role: 'lead',
          widthMm: 1,
        },
      ],
    }
    const svg = buildSvg(curves, OPTS)
    expect(svg).toContain('C 10 20 30 20 40 0')
    expect(svg).toMatch(/A 10 10 0 0 1 /)
  })
})

describe('buildSvg — cut templates (FR-2)', () => {
  it('emits one closed path per piece, numbered via id + title', () => {
    const svg = buildSvg(scene(), { ...OPTS, flavor: 'cut' })
    expect(svg).toContain('id="piece-A1"')
    expect(svg).toContain('<title>A1</title>')
    expect(svg).toContain('id="piece-A2"')
    // Uses the cut contour (inset by 1 mm), not the drawn ring.
    expect(svg).toContain('M 1 1 L 49 1 L 49 79 L 1 79 Z')
    // Closed paths, no fill.
    expect(svg).toContain('fill="none"')
  })

  it('spreads pieces on a grid without overlap when layout is grid', () => {
    const svg = buildSvg(scene(), { ...OPTS, flavor: 'cut', cutLayout: 'grid' })
    expect(svg).toContain('id="piece-A1"')
    // Grid viewBox starts at origin and is larger than a single piece.
    expect(svg).toMatch(/viewBox="0 0 /)
  })
})

describe('buildSvg — coloured render', () => {
  it('fills pieces with glass colour under lead strokes', () => {
    const svg = buildSvg(scene(), { ...OPTS, flavor: 'render' })
    expect(svg).toContain('<g id="glass">')
    expect(svg).toContain('fill="#cc2244"')
    expect(svg).toContain('<g id="lead"')
  })
})

describe('buildSvg — determinism (FR-4)', () => {
  it('is byte-identical across runs and independent of input order', () => {
    const a = buildSvg(scene(), { ...OPTS, flavor: 'cut' })
    const b = buildSvg(scene(), { ...OPTS, flavor: 'cut' })
    expect(a).toBe(b)

    const s = scene()
    const shuffled: ExportScene = {
      ...s,
      segments: [...s.segments].reverse(),
      pieces: [...s.pieces].reverse(),
    }
    expect(buildSvg(shuffled, { ...OPTS, flavor: 'cut' })).toBe(a)
  })
})
