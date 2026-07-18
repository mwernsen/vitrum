import { createEmptyProject, createSegment } from '@vitrum/model'
import { arc, line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { documentBounds, segmentToWorldPoints, stressScene } from './scene'

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

describe('stressScene', () => {
  it('generates the requested number of segments', () => {
    const project = stressScene(5000)
    expect(Object.keys(project.segments)).toHaveLength(5000)
    expect(project.settings.name).toBe('Stress test')
  })
})
