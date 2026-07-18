import { area, distance, vec2, type Arc, type Line } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import {
  ellipseDrafts,
  rectangleCorners,
  rectangleDrafts,
  regularPolygonVertices,
  regularPolygonDrafts,
} from './shapes'

describe('rectangleDrafts', () => {
  it('emits four welded line segments forming a closed loop', () => {
    const drafts = rectangleDrafts(vec2(0, 0), vec2(100, 60))
    expect(drafts).toHaveLength(4)
    for (const d of drafts) expect(d.geometry.kind).toBe('line')
    // Each span's end is the next span's start (coincident welds).
    const lines = drafts.map((d) => d.geometry as Line)
    for (let i = 0; i < 4; i++) expect(lines[i]!.b).toEqual(lines[(i + 1) % 4]!.a)
  })

  it('orders corners around the rectangle', () => {
    expect(rectangleCorners(vec2(0, 0), vec2(10, 5))).toEqual([
      vec2(0, 0),
      vec2(10, 0),
      vec2(10, 5),
      vec2(0, 5),
    ])
  })

  it('is empty for a degenerate rectangle', () => {
    expect(rectangleDrafts(vec2(0, 0), vec2(0, 40))).toHaveLength(0)
  })
})

describe('regularPolygon', () => {
  it('places N vertices on the circumscribed circle', () => {
    const verts = regularPolygonVertices(vec2(0, 0), vec2(10, 0), 6)
    expect(verts).toHaveLength(6)
    for (const v of verts) expect(distance(vec2(0, 0), v)).toBeCloseTo(10, 9)
  })

  it('emits N welded line segments', () => {
    const drafts = regularPolygonDrafts(vec2(0, 0), vec2(10, 0), 5)
    expect(drafts).toHaveLength(5)
    const lines = drafts.map((d) => d.geometry as Line)
    for (let i = 0; i < 5; i++) expect(lines[i]!.b).toEqual(lines[(i + 1) % 5]!.a)
  })

  it('a square N-gon has the expected area', () => {
    const verts = regularPolygonVertices(vec2(0, 0), vec2(10, 0), 4)
    // A square inscribed in radius 10 has diagonals 20 ⇒ area = 200.
    expect(area({ kind: 'polygon', outer: verts, holes: [] })).toBeCloseTo(200, 6)
  })
})

describe('ellipseDrafts', () => {
  it('emits a single exact arc for a circle', () => {
    const drafts = ellipseDrafts(vec2(0, 0), 25, 25)
    expect(drafts).toHaveLength(1)
    const geo = drafts[0]!.geometry as Arc
    expect(geo.kind).toBe('arc')
    expect(geo.radius).toBe(25)
  })

  it('emits four welded cubics for an ellipse', () => {
    const drafts = ellipseDrafts(vec2(0, 0), 40, 20)
    expect(drafts).toHaveLength(4)
    for (const d of drafts) expect(d.geometry.kind).toBe('cubic')
  })

  it('is empty for a degenerate axis', () => {
    expect(ellipseDrafts(vec2(0, 0), 0, 20)).toHaveLength(0)
  })
})
