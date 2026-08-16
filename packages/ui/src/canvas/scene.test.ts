import { createEmptyProject, createSegment } from '@vitrum/model'
import { arc, line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import {
  defaultSymmetryCenter,
  documentBounds,
  panelInsetMm,
  panelRect,
  segmentToWorldPoints,
  stressScene,
} from './scene'

describe('segmentToWorldPoints', () => {
  it('keeps a line as its two endpoints', () => {
    expect(segmentToWorldPoints(line(vec2(0, 0), vec2(100, 50)))).toEqual([
      vec2(0, 0),
      vec2(100, 50),
    ])
  })

  it('samples a curve into a polyline whose ends match the curve', () => {
    const a = arc(vec2(0, 0), 10, 0, Math.PI, true)
    const points = segmentToWorldPoints(a)
    expect(points.length).toBeGreaterThan(2)
    expect(points[0]!.x).toBeCloseTo(10, 6)
    expect(points[points.length - 1]!.x).toBeCloseTo(-10, 6)
  })
})

describe('documentBounds', () => {
  it('is null for an empty project', () => {
    expect(documentBounds(createEmptyProject())).toBeNull()
  })

  it('unions segment boxes and the panel rectangle', () => {
    const base = createEmptyProject({ panelSize: { width: 200, height: 100 } })
    const seg = createSegment(line(vec2(-50, 0), vec2(0, 300)))
    const project = { ...base, segments: { [seg.id]: seg } }
    const box = documentBounds(project)
    expect(box).not.toBeNull()
    expect(box!.min).toEqual(vec2(-50, 0))
    expect(box!.max).toEqual(vec2(200, 300))
  })
})

describe('panelRect (F-058)', () => {
  it('spans the origin to the panel size in world mm', () => {
    const project = createEmptyProject({ panelSize: { width: 300, height: 400 } })
    expect(panelRect(project)).toEqual({ min: vec2(0, 0), max: vec2(300, 400) })
  })

  it('is null without a panel size, so nothing is framed', () => {
    expect(panelRect(createEmptyProject())).toBeNull()
  })
})

describe('panelInsetMm (F-033)', () => {
  it('is half the default came flange — where the drawn border belongs inside the finished panel', () => {
    // Default technique is lead with the H 5 mm profile (F-021 FR-5), centred on the drawn line.
    expect(panelInsetMm(createEmptyProject())).toBeCloseTo(2.5)
  })

  it('follows the came fitted on the border segments', () => {
    const base = createEmptyProject()
    const border = { ...createSegment(line(vec2(0, 0), vec2(300, 0))), role: 'border' as const }
    const project = {
      ...base,
      segments: { [border.id]: border },
      technique: {
        ...base.technique,
        lead: { ...base.technique.lead, overrides: { [border.id]: { profileId: 'came-u-9' } } },
      },
    }
    expect(panelInsetMm(project)).toBeCloseTo(4.5)
  })

  it('is zero for copper foil, where the drawn border is the panel edge', () => {
    const base = createEmptyProject()
    expect(panelInsetMm({ ...base, technique: { ...base.technique, kind: 'foil' } })).toBe(0)
  })
})

describe('defaultSymmetryCenter (F-052)', () => {
  it('is the panel centre, not its top-left corner', () => {
    const project = createEmptyProject({ panelSize: { width: 300, height: 400 } })
    expect(defaultSymmetryCenter(project)).toEqual(vec2(150, 200))
  })

  it('falls back to the centre of what is drawn when there is no panel size', () => {
    const base = createEmptyProject()
    const seg = createSegment(line(vec2(20, 40), vec2(120, 140)))
    expect(defaultSymmetryCenter({ ...base, segments: { [seg.id]: seg } })).toEqual(vec2(70, 90))
  })

  it('falls back to the origin on an empty, size-less document', () => {
    expect(defaultSymmetryCenter(createEmptyProject())).toEqual(vec2(0, 0))
  })

  it('prefers the panel over the drawn content, so a stray line cannot move the pivot', () => {
    const base = createEmptyProject({ panelSize: { width: 300, height: 400 } })
    const seg = createSegment(line(vec2(-500, -500), vec2(-400, -400)))
    expect(defaultSymmetryCenter({ ...base, segments: { [seg.id]: seg } })).toEqual(vec2(150, 200))
  })
})

describe('stressScene', () => {
  it('generates the requested number of segments', () => {
    const project = stressScene(5000)
    expect(Object.keys(project.segments)).toHaveLength(5000)
    expect(project.settings.name).toBe('Stress test')
  })
})
