import { distance, vec2, type Line } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { lineTool, type LineState } from './line'
import type { SegmentDraft, ToolInput } from './types'

/** Fold a whole input sequence into the line tool, collecting every commit it emits. */
function run(inputs: readonly ToolInput[]): {
  state: LineState
  commits: SegmentDraft[][]
} {
  let state = lineTool.initial
  const commits: SegmentDraft[][] = []
  for (const input of inputs) {
    const step = lineTool.reduce(state, input)
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

describe('lineTool', () => {
  it('a two-click chain then enter commits one span', () => {
    const { commits } = run([down(0, 0), down(100, 0), { type: 'enter' }])
    expect(commits).toHaveLength(1)
    expect(commits[0]).toHaveLength(1)
    const geo = commits[0]![0]!.geometry as Line
    expect(geo.kind).toBe('line')
    expect(geo.a).toEqual(vec2(0, 0))
    expect(geo.b).toEqual(vec2(100, 0))
    expect(commits[0]![0]!.role).toBe('lead')
  })

  it('polyline chaining welds spans at shared, coincident anchors', () => {
    const { commits } = run([down(0, 0), down(100, 0), down(100, 80), { type: 'enter' }])
    const drafts = commits[0]!
    expect(drafts).toHaveLength(2)
    const first = drafts[0]!.geometry as Line
    const second = drafts[1]!.geometry as Line
    // The shared node is the exact same value in both spans — coincident for F-020.
    expect(first.b).toEqual(second.a)
    expect(second.a).toEqual(vec2(100, 0))
  })

  it('commits nothing and resets when only one point was placed', () => {
    const { commits, state } = run([down(10, 10), { type: 'enter' }])
    expect(commits).toHaveLength(0)
    expect(state.anchors).toEqual([])
  })

  it('escape discards the in-progress chain without a commit', () => {
    const { commits, state } = run([down(0, 0), down(50, 0), { type: 'escape' }])
    expect(commits).toHaveLength(0)
    expect(state.anchors).toEqual([])
    expect(lineTool.isActive(state)).toBe(false)
  })

  it('shift constrains a span to the nearest 45° while keeping its length', () => {
    // Second click drifts off 45°; shift snaps it onto the diagonal.
    const { commits } = run([down(0, 0), down(100, 90, true), { type: 'enter' }])
    const geo = commits[0]![0]!.geometry as Line
    // Snapped onto y = x, same distance from the origin as the raw point.
    expect(geo.b.x).toBeCloseTo(geo.b.y, 6)
    expect(distance(geo.a, geo.b)).toBeCloseTo(Math.hypot(100, 90), 6)
  })

  it('shift also constrains parallel to a reference line the span starts from', () => {
    // A reference line at 20°; the second click is at ~22°, off every 45° ray.
    const refDirs = [vec2(Math.cos(0.349), Math.sin(0.349))]
    const raw = vec2(Math.cos(0.384) * 100, Math.sin(0.384) * 100)
    const { commits } = run([
      down(0, 0),
      { type: 'down', at: raw, shift: true, refDirs },
      { type: 'enter' },
    ])
    const geo = commits[0]![0]!.geometry as Line
    expect(Math.atan2(geo.b.y, geo.b.x)).toBeCloseTo(0.349, 6)
    expect(distance(geo.a, geo.b)).toBeCloseTo(100, 6)
  })

  it('numeric entry places a span of an exact length (FR-2)', () => {
    // Click origin, move to give a direction, then type a 100 mm length.
    const { commits } = run([
      down(0, 0),
      { type: 'move', at: vec2(10, 0) },
      { type: 'numeric', value: { length: 100 } },
      { type: 'enter' },
    ])
    const geo = commits[0]![0]!.geometry as Line
    expect(distance(geo.a, geo.b)).toBeCloseTo(100, 9)
    expect(geo.b).toEqual(vec2(100, 0))
  })

  it('numeric entry with an explicit angle ignores the cursor direction', () => {
    const { commits } = run([
      down(0, 0),
      { type: 'numeric', value: { length: 50, angle: 90 } },
      { type: 'enter' },
    ])
    const geo = commits[0]![0]!.geometry as Line
    // 90° in the Y-down world points straight down (+y).
    expect(geo.b.x).toBeCloseTo(0, 9)
    expect(geo.b.y).toBeCloseTo(50, 9)
  })

  it('reports active state and previews a rubber band to the moving cursor', () => {
    const placed = lineTool.reduce(lineTool.initial, down(0, 0))
    expect(lineTool.isActive(placed.state)).toBe(true)
    expect(lineTool.anchors!(placed.state)).toEqual([vec2(0, 0)])
    // A rubber band appears once the cursor moves away from the placed anchor.
    const moved = lineTool.reduce(placed.state, { type: 'move', at: vec2(40, 0) })
    const shapes = lineTool.preview(moved.state, null)
    const ghost = shapes.find((s) => s.kind === 'segment' && s.ghost)
    expect(ghost).toBeDefined()
  })
})
