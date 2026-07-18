import { isArc, isLine, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { guideTool, type GuideState } from './guide'
import type { SegmentDraft, ToolInput } from './types'

/** Fold inputs into the guide tool, returning the last commit (if any) and final state. */
function run(
  inputs: ToolInput[],
  start: GuideState = guideTool.initial,
): { state: GuideState; commit?: readonly SegmentDraft[] } {
  let state = start
  let commit: readonly SegmentDraft[] | undefined
  for (const input of inputs) {
    const step = guideTool.reduce(state, input)
    state = step.state
    if (step.commit) commit = step.commit
  }
  return { state, commit }
}

const down = (x: number, y: number): ToolInput => ({ type: 'down', at: vec2(x, y) })

describe('guideTool', () => {
  it('commits a horizontal infinite guide line on a single click', () => {
    const { commit } = run([down(5, 7)])
    expect(commit).toHaveLength(1)
    const draft = commit![0]!
    expect(draft.role).toBe('construction')
    expect(isLine(draft.geometry)).toBe(true)
    if (isLine(draft.geometry)) {
      // Horizontal: both endpoints share the click's y, and the span is effectively infinite.
      expect(draft.geometry.a.y).toBe(7)
      expect(draft.geometry.b.y).toBe(7)
      expect(draft.geometry.b.x - draft.geometry.a.x).toBeGreaterThan(1e5)
    }
  })

  it('commits a vertical guide after cycling to the vertical mode', () => {
    const vertical = guideTool.cycleMode!(guideTool.initial)
    const { commit } = run([down(3, 9)], vertical)
    const draft = commit![0]!
    expect(isLine(draft.geometry)).toBe(true)
    if (isLine(draft.geometry)) {
      expect(draft.geometry.a.x).toBe(3)
      expect(draft.geometry.b.x).toBe(3)
    }
  })

  it('draws an angled guide through the first point toward the second (two clicks)', () => {
    let mode = guideTool.initial
    mode = guideTool.cycleMode!(mode) // vertical
    mode = guideTool.cycleMode!(mode) // angled
    const first = guideTool.reduce(mode, down(0, 0))
    expect(first.commit).toBeUndefined()
    expect(guideTool.isActive(first.state)).toBe(true)
    const second = guideTool.reduce(first.state, down(10, 10))
    const draft = second.commit![0]!
    expect(draft.role).toBe('construction')
    if (isLine(draft.geometry)) {
      // The line passes through the origin with a 45° direction.
      const dir = vec2(
        draft.geometry.b.x - draft.geometry.a.x,
        draft.geometry.b.y - draft.geometry.a.y,
      )
      expect(dir.x).toBeCloseTo(dir.y, 6)
    }
  })

  it('draws a guide circle from centre and radius point', () => {
    let mode = guideTool.initial
    for (let i = 0; i < 3; i++) mode = guideTool.cycleMode!(mode) // → circle
    const centre = guideTool.reduce(mode, down(0, 0))
    const step = guideTool.reduce(centre.state, down(10, 0))
    const draft = step.commit![0]!
    expect(draft.role).toBe('construction')
    expect(isArc(draft.geometry)).toBe(true)
    if (isArc(draft.geometry)) expect(draft.geometry.radius).toBeCloseTo(10, 9)
  })

  it('cancels an in-progress two-click gesture on escape', () => {
    let mode = guideTool.initial
    mode = guideTool.cycleMode!(mode)
    mode = guideTool.cycleMode!(mode) // angled
    const first = guideTool.reduce(mode, down(1, 1))
    const cancelled = guideTool.reduce(first.state, { type: 'escape' })
    expect(guideTool.isActive(cancelled.state)).toBe(false)
    expect(cancelled.commit).toBeUndefined()
  })
})
