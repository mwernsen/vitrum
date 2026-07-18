import { distance, pointAt, vec2, type Arc, type Line } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { arcFromCenter, arcThroughPoints, arcTool, circumcenter, type ArcState } from './arc'
import type { SegmentDraft, ToolInput } from './types'

function run(inputs: readonly ToolInput[], start: ArcState = arcTool.initial) {
  let state = start
  const commits: SegmentDraft[][] = []
  for (const input of inputs) {
    const step = arcTool.reduce(state, input)
    state = step.state
    if (step.commit) commits.push([...step.commit])
  }
  return { state, commits }
}

const down = (x: number, y: number, shift = false): ToolInput => ({
  type: 'down',
  at: vec2(x, y),
  shift,
})

describe('circumcenter', () => {
  it('finds the centre equidistant from three points', () => {
    const c = circumcenter(vec2(1, 0), vec2(0, 1), vec2(-1, 0))!
    expect(c.x).toBeCloseTo(0, 9)
    expect(c.y).toBeCloseTo(0, 9)
  })

  it('returns null for collinear points', () => {
    expect(circumcenter(vec2(0, 0), vec2(1, 0), vec2(2, 0))).toBeNull()
  })
})

describe('arcThroughPoints', () => {
  it('builds an arc that passes through all three points', () => {
    const geo = arcThroughPoints(vec2(1, 0), vec2(0, 1), vec2(-1, 0)) as Arc
    expect(geo.kind).toBe('arc')
    expect(geo.radius).toBeCloseTo(1, 9)
    // The through-point is on the swept arc.
    let onArc = false
    for (let t = 0; t <= 1; t += 0.05) {
      if (distance(pointAt(geo, t), vec2(0, 1)) < 1e-6) onArc = true
    }
    expect(onArc).toBe(true)
  })

  it('degenerates to a straight line for collinear input', () => {
    const geo = arcThroughPoints(vec2(0, 0), vec2(1, 0), vec2(2, 0)) as Line
    expect(geo.kind).toBe('line')
  })
})

describe('arcFromCenter', () => {
  it('builds an arc of the start radius sweeping toward the end direction', () => {
    const geo = arcFromCenter(vec2(0, 0), vec2(10, 0), vec2(0, 5)) as Arc
    expect(geo.kind).toBe('arc')
    expect(geo.radius).toBeCloseTo(10, 9)
    expect(distance(pointAt(geo, 0), vec2(10, 0))).toBeCloseTo(0, 6)
  })

  it('returns null when the start coincides with the centre', () => {
    expect(arcFromCenter(vec2(0, 0), vec2(0, 0), vec2(1, 1))).toBeNull()
  })
})

describe('arcTool', () => {
  it('three clicks in three-point mode commit one arc', () => {
    const { commits } = run([down(1, 0), down(-1, 0), down(0, 1)])
    expect(commits).toHaveLength(1)
    expect(commits[0]![0]!.geometry.kind).toBe('arc')
  })

  it('center mode: centre, start, end commit one arc of the start radius', () => {
    const centred = arcTool.cycleMode!(arcTool.initial)
    expect(centred.mode).toBe('center')
    const { commits } = run([down(0, 0), down(20, 0), down(0, 20)], centred)
    const geo = commits[0]![0]!.geometry as Arc
    expect(geo.kind).toBe('arc')
    expect(geo.radius).toBeCloseTo(20, 6)
  })

  it('escape discards the in-progress arc but keeps the mode', () => {
    const { state, commits } = run([down(1, 0), down(-1, 0), { type: 'escape' }])
    expect(commits).toHaveLength(0)
    expect(state.points).toEqual([])
  })

  it('numeric entry sets an exact radius in center mode (FR-3)', () => {
    const centred = arcTool.cycleMode!(arcTool.initial)
    const { commits } = run(
      [
        down(0, 0), // centre
        { type: 'move', at: vec2(1, 0) },
        { type: 'numeric', value: { length: 50 } }, // start at radius 50
        down(0, 50), // end
      ],
      centred,
    )
    const geo = commits[0]![0]!.geometry as Arc
    expect(geo.radius).toBeCloseTo(50, 6)
  })
})
