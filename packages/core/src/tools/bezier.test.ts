import { equals, vec2, type CubicBezier } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { bezierTool } from './bezier'
import type { SegmentDraft, ToolInput } from './types'

function run(inputs: readonly ToolInput[]) {
  let state = bezierTool.initial
  const commits: SegmentDraft[][] = []
  for (const input of inputs) {
    const step = bezierTool.reduce(state, input)
    state = step.state
    if (step.commit) commits.push([...step.commit])
  }
  return { state, commits }
}

/** A click with no drag: down then up at the same point. */
const click = (x: number, y: number): ToolInput[] => [
  { type: 'down', at: vec2(x, y) },
  { type: 'up', at: vec2(x, y) },
]

/** A click-drag: down at the anchor, move to the handle, up. */
const drag = (x: number, y: number, hx: number, hy: number, alt = false): ToolInput[] => [
  { type: 'down', at: vec2(x, y), alt },
  { type: 'move', at: vec2(hx, hy) },
  { type: 'up', at: vec2(hx, hy) },
]

describe('bezierTool', () => {
  it('two plain clicks then enter make a straight cubic (control points at endpoints)', () => {
    const { commits } = run([...click(0, 0), ...click(100, 0), { type: 'enter' }])
    const geo = commits[0]![0]!.geometry as CubicBezier
    expect(geo.kind).toBe('cubic')
    expect(geo.p0).toEqual(vec2(0, 0))
    expect(geo.p3).toEqual(vec2(100, 0))
    expect(equals(geo.p1, geo.p0)).toBe(true) // no handle ⇒ straight
    expect(equals(geo.p2, geo.p3)).toBe(true)
  })

  it('a drag sets symmetric handles, giving tangent continuity by default', () => {
    // Anchor A at origin dragged up sets A.out = (0,-20); anchor B a plain click.
    const { commits } = run([...drag(0, 0, 0, -20), ...click(100, 0), { type: 'enter' }])
    const geo = commits[0]![0]!.geometry as CubicBezier
    // p1 = A + out = (0,-20); the outgoing handle is present.
    expect(geo.p1).toEqual(vec2(0, -20))
  })

  it('alt breaks the tangent: the cusp anchor contributes no incoming handle', () => {
    // B placed with Alt+drag ⇒ its incoming handle is zero (cusp), so p2 == p3.
    const { commits } = run([...click(0, 0), ...drag(100, 0, 120, 20, true), { type: 'enter' }])
    const geo = commits[0]![0]!.geometry as CubicBezier
    expect(equals(geo.p2, geo.p3)).toBe(true)
  })

  it('a single anchor commits nothing', () => {
    const { commits, state } = run([...click(0, 0), { type: 'enter' }])
    expect(commits).toHaveLength(0)
    expect(bezierTool.isActive(state)).toBe(false)
  })

  it('escape discards the in-progress path', () => {
    const { commits, state } = run([...click(0, 0), ...click(50, 0), { type: 'escape' }])
    expect(commits).toHaveLength(0)
    expect(state.anchors).toEqual([])
  })

  it('welds consecutive cubics at shared anchor points', () => {
    const { commits } = run([...click(0, 0), ...click(50, 0), ...click(100, 0), { type: 'enter' }])
    const [a, b] = commits[0]!.map((d) => d.geometry as CubicBezier)
    expect(a!.p3).toEqual(b!.p0)
  })
})
