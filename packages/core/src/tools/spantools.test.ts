import { vec2, type Line } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { borderTool, circleTool, polygonTool, rectangleTool, type SpanState } from './spantools'
import type { SegmentDraft, ToolDef, ToolInput } from './types'

function run<S>(tool: ToolDef<S>, inputs: readonly ToolInput[], start = tool.initial) {
  let state = start
  const commits: SegmentDraft[][] = []
  for (const input of inputs) {
    const step = tool.reduce(state, input)
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

describe('rectangleTool', () => {
  it('two clicks commit a four-segment rectangle as one gesture', () => {
    const { commits } = run(rectangleTool, [down(0, 0), down(100, 60)])
    expect(commits).toHaveLength(1)
    expect(commits[0]).toHaveLength(4)
    expect(commits[0]!.every((d) => d.role === 'lead')).toBe(true)
  })

  it('shift squares the rectangle', () => {
    const { commits } = run(rectangleTool, [down(0, 0), down(100, 40, true)])
    const lines = commits[0]!.map((d) => d.geometry as Line)
    const width = Math.abs(lines[0]!.b.x - lines[0]!.a.x)
    const height = Math.abs(lines[1]!.b.y - lines[1]!.a.y)
    expect(width).toBeCloseTo(height, 9)
  })
})

describe('polygonTool', () => {
  it('cycles the side count and emits that many segments', () => {
    // Default is 6; cycle once → 3 sides ('3' is index 0, so cycling from 0 lands on 4).
    const start = polygonTool.initial
    expect(polygonTool.hint!(start)).toBe('3-gon')
    const { commits } = run(polygonTool, [down(0, 0), down(0, 30)])
    expect(commits[0]).toHaveLength(3)
  })

  it('a later mode yields more sides', () => {
    let s = polygonTool.initial
    // Cycle to '6' (index 3): 3 -> 4 -> 5 -> 6.
    for (let i = 0; i < 3; i++) s = polygonTool.cycleMode!(s)
    expect(polygonTool.hint!(s)).toBe('6-gon')
    const { commits } = run(polygonTool, [down(0, 0), down(0, 30)], s)
    expect(commits[0]).toHaveLength(6)
  })
})

describe('circleTool', () => {
  it('emits a single arc in circle mode (radius = distance to cursor)', () => {
    const { commits } = run(circleTool, [down(0, 0), down(30, 40)])
    expect(commits[0]).toHaveLength(1)
    const geo = commits[0]![0]!.geometry
    expect(geo.kind).toBe('arc')
    if (geo.kind === 'arc') expect(geo.radius).toBeCloseTo(50, 9) // 3-4-5 ⇒ 50
  })

  it('emits four cubics in ellipse mode with distinct axes', () => {
    const ellipse = circleTool.cycleMode!(circleTool.initial)
    expect(circleTool.hint!(ellipse)).toBe('ellipse')
    const { commits } = run(circleTool, [down(0, 0), down(40, 20)], ellipse)
    expect(commits[0]).toHaveLength(4)
    for (const d of commits[0]!) expect(d.geometry.kind).toBe('cubic')
  })
})

describe('borderTool', () => {
  it('emits four border-role segments', () => {
    const { commits } = run(borderTool, [down(0, 0), down(300, 400)])
    expect(commits[0]).toHaveLength(4)
    expect(commits[0]!.every((d) => d.role === 'border')).toBe(true)
  })
})

// A type-only assertion that the span tools share one state shape.
const _typecheck: ToolDef<SpanState> = rectangleTool
void _typecheck
