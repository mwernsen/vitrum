import { arcPointAt, cubicPointAt, lerp, type Vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { parseSvg, scaleGeometries } from './parse'
import { parseXml } from './xml'
import type { PathGeometry } from './path'

function endsAt(g: PathGeometry, t: number): Vec2 {
  if (g.kind === 'line') return lerp(g.a, g.b, t)
  if (g.kind === 'cubic') return cubicPointAt(g, t)
  return arcPointAt(g, t)
}

describe('parseXml', () => {
  it('parses nested elements, attributes and self-closing tags', () => {
    const root = parseXml('<svg width="10"><g id="a"><rect x="1" y="2"/></g></svg>')
    expect(root.name).toBe('svg')
    expect(root.attrs['width']).toBe('10')
    expect(root.children[0]!.name).toBe('g')
    expect(root.children[0]!.children[0]!.name).toBe('rect')
  })

  it('skips comments, declarations and doctype', () => {
    const root = parseXml(
      '<?xml version="1.0"?>\n<!DOCTYPE svg><!-- hi --><svg><path d="M0 0"/></svg>',
    )
    expect(root.name).toBe('svg')
    expect(root.children[0]!.name).toBe('path')
  })

  it('decodes entities in attribute values', () => {
    const root = parseXml('<svg data-x="a &amp; b"></svg>')
    expect(root.attrs['data-x']).toBe('a & b')
  })

  it('throws on a mismatched closing tag', () => {
    expect(() => parseXml('<svg><g></svg>')).toThrow()
  })
})

describe('parseSvg — shapes', () => {
  it('parses a rect into four lines', () => {
    const { geometries } = parseSvg('<svg><rect x="0" y="0" width="10" height="20"/></svg>')
    expect(geometries).toHaveLength(4)
    expect(geometries.every((g) => g.kind === 'line')).toBe(true)
  })

  it('parses a circle into one full arc', () => {
    const { geometries } = parseSvg('<svg><circle cx="5" cy="5" r="3"/></svg>')
    expect(geometries).toHaveLength(1)
    expect(geometries[0]!.kind).toBe('arc')
  })

  it('parses polyline and polygon', () => {
    const poly = parseSvg('<svg><polyline points="0,0 10,0 10,10"/></svg>')
    expect(poly.geometries).toHaveLength(2)
    const closed = parseSvg('<svg><polygon points="0,0 10,0 10,10"/></svg>')
    expect(closed.geometries).toHaveLength(3)
  })

  it('parses an ellipse into cubics', () => {
    const { geometries } = parseSvg('<svg><ellipse cx="0" cy="0" rx="20" ry="10"/></svg>')
    expect(geometries.length).toBeGreaterThan(1)
    expect(geometries.every((g) => g.kind === 'cubic')).toBe(true)
  })
})

describe('parseSvg — transforms compose to a single CTM', () => {
  it('applies nested group transforms to shape coordinates', () => {
    const svg =
      '<svg><g transform="translate(100 0)"><g transform="scale(2)">' +
      '<line x1="0" y1="0" x2="10" y2="0"/></g></g></svg>'
    const { geometries } = parseSvg(svg)
    expect(geometries).toHaveLength(1)
    // (0,0) → scale 2 → (0,0) → translate 100 → (100,0); (10,0) → (20,0) → (120,0).
    expect(endsAt(geometries[0]!, 0)).toEqual({ x: 100, y: 0 })
    expect(endsAt(geometries[0]!, 1)).toEqual({ x: 120, y: 0 })
  })
})

describe('parseSvg — dropped content (FR-5)', () => {
  it('reports text, raster, gradients and clip paths, never silently dropping them', () => {
    const svg =
      '<svg>' +
      '<defs><linearGradient id="g"/><clipPath id="c"/></defs>' +
      '<text x="0" y="0">hi</text>' +
      '<image href="a.png"/>' +
      '<rect x="0" y="0" width="5" height="5" clip-path="url(#c)"/>' +
      '</svg>'
    const { geometries, dropped } = parseSvg(svg)
    expect(geometries).toHaveLength(4) // the rect still imports
    expect(dropped).toContain('text')
    expect(dropped).toContain('raster images')
    expect(dropped).toContain('gradients')
    expect(dropped).toContain('clip paths')
  })

  it('skips shapes defined inside <defs>', () => {
    const { geometries } = parseSvg('<svg><defs><rect x="0" y="0" width="5" height="5"/></defs></svg>')
    expect(geometries).toHaveLength(0)
  })
})

describe('scaleGeometries', () => {
  it('scales user units to mm', () => {
    const { geometries } = parseSvg('<svg><line x1="0" y1="0" x2="10" y2="0"/></svg>')
    const scaled = scaleGeometries(geometries, 0.5)
    expect(endsAt(scaled[0]!, 1)).toEqual({ x: 5, y: 0 })
  })
})
