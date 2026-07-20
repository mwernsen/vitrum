import type { CutContour, LabelPlacement, Piece } from '@vitrum/core'
import { line, vec2, type BBox } from '@vitrum/geometry'
import type { Glass, GlassId, Segment } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { buildPrintScene, type PrintSceneInput } from './scene'

const BOUNDS: BBox = { min: vec2(0, 0), max: vec2(300, 400) }

function segment(id: string, role: Segment['role']): Segment {
  return {
    id,
    geometry: line(vec2(0, 0), vec2(100, 0)),
    role,
    endpoints: ['a', 'b'],
  } as unknown as Segment
}

function piece(id: string): Piece {
  const ring = [vec2(0, 0), vec2(100, 0), vec2(100, 100), vec2(0, 100)]
  return {
    id,
    ring,
    holeRings: [],
    area: 10000,
    perimeter: 400,
    centroid: vec2(50, 50),
    bbox: { min: vec2(0, 0), max: vec2(100, 100) },
    boundary: [],
    holes: [],
  } as unknown as Piece
}

const glass: Glass = { id: 'g1', name: 'Ruby', color: '#cc3344' } as unknown as Glass

function input(overrides: Partial<PrintSceneInput> = {}): PrintSceneInput {
  const p = piece('P1')
  return {
    contentBounds: BOUNDS,
    segments: [segment('s1', 'lead'), segment('s2', 'border')],
    leadWidthMm: (s) => (s.role === 'border' ? 4 : 1.5),
    pieces: [p],
    cutContours: [
      {
        ring: [vec2(5, 5), vec2(95, 5), vec2(95, 95)],
        holeRings: [],
        degenerate: false,
      } as unknown as CutContour,
    ],
    glassFor: () => 'g1' as GlassId,
    glasses: { g1: glass } as Record<GlassId, Glass>,
    labelFor: () => 'A1',
    placementFor: () => ({ at: vec2(50, 50), radius: 12 }) as LabelPlacement,
    legend: [{ code: 'A', name: 'Ruby', color: '#cc3344', count: 1 }],
    ...overrides,
  }
}

describe('buildPrintScene', () => {
  it('flattens every segment with its role and resolved width', () => {
    const scene = buildPrintScene(input())
    expect(scene.network).toHaveLength(2)
    const border = scene.network.find((n) => n.role === 'border')!
    expect(border.widthMm).toBe(4)
    expect(scene.network[0]!.points.length).toBeGreaterThanOrEqual(2)
  })

  it('resolves each piece to its glass colour, label and placement', () => {
    const scene = buildPrintScene(input())
    expect(scene.pieces).toHaveLength(1)
    expect(scene.pieces[0]!.fillColor).toBe('#cc3344')
    expect(scene.pieces[0]!.label).toBe('A1')
    expect(scene.pieces[0]!.labelAt).toEqual(vec2(50, 50))
    expect(scene.pieces[0]!.labelRadiusMm).toBe(12)
  })

  it('leaves fill/label undefined for an unassigned, unnumbered piece', () => {
    const scene = buildPrintScene(input({ glassFor: () => undefined, labelFor: () => undefined }))
    expect(scene.pieces[0]!.fillColor).toBeUndefined()
    expect(scene.pieces[0]!.label).toBeUndefined()
  })

  it('expands cut contours (outer + holes) into flat rings', () => {
    const scene = buildPrintScene(
      input({
        cutContours: [
          {
            ring: [vec2(0, 0), vec2(10, 0), vec2(10, 10)],
            holeRings: [[vec2(3, 3), vec2(5, 3), vec2(5, 5)]],
            degenerate: false,
          } as unknown as CutContour,
        ],
      }),
    )
    expect(scene.cutLines).toHaveLength(2)
  })

  it('passes the legend through', () => {
    const scene = buildPrintScene(input())
    expect(scene.legend[0]).toEqual({ code: 'A', name: 'Ruby', color: '#cc3344', count: 1 })
  })
})
