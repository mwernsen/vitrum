import { line, vec2 } from '@vitrum/geometry'
import { createEmptyProject, weldSegments, type Segment } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { TOPOLOGY_RULES } from './rules/topology'
import { runChecks } from './run'
import { buildInput } from './test/harness'

/**
 * Violation keys must be unique within a run.
 *
 * The key is both the waiver id (`Project.drc.exclusions`) and the list key the violations panel
 * renders by, so a collision has two costs: waiving one violation silently waives its twin, and the
 * panel throws `each_key_duplicate` before painting a single row — the Check tab simply fails.
 *
 * Found on a real traced cartoon (F-059), which is full of fragments dangling at **both** ends: one
 * segment, two `dangling-end` diagnostics. Keyed on segment ids alone they collapsed to one key.
 * A diagnostic is *located*, so the three diagnostic-derived rules include a rounded position.
 */
function projectOf(drafts: readonly { geometry: ReturnType<typeof line>; role: 'lead' }[]) {
  const { segments, nodes } = weldSegments(drafts)
  const byId: Record<string, Segment> = {}
  for (const s of segments) byId[s.id] = s
  return { ...createEmptyProject(), segments: byId, nodes }
}

const lead = (ax: number, ay: number, bx: number, by: number) =>
  ({ geometry: line(vec2(ax, ay), vec2(bx, by)), role: 'lead' }) as const

describe('violation keys are unique', () => {
  it('gives a segment dangling at both ends two distinct keys', () => {
    // One isolated segment, joined to nothing at either end — the traced-fragment shape.
    const project = projectOf([lead(10, 10, 60, 10)])
    const input = buildInput(project)

    const dangling = input.diagnostics.filter((d) => d.kind === 'dangling-end')
    expect(dangling).toHaveLength(2)

    const result = runChecks(input, TOPOLOGY_RULES)
    const keys = result.violations.filter((v) => v.ruleId === 'dangling-line').map((v) => v.key)
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
  })

  it('keeps every key unique across a scene full of dangling fragments', () => {
    // What an autotrace of a cartoon actually produces: many short, unconnected runs.
    const project = projectOf([
      lead(10, 10, 60, 10),
      lead(10, 30, 60, 30),
      lead(10, 50, 60, 50),
      lead(80, 10, 80, 60),
      lead(100, 10, 140, 50),
    ])
    const result = runChecks(buildInput(project), TOPOLOGY_RULES)

    const keys = result.violations.map((v) => v.key)
    expect(keys.length).toBeGreaterThan(5)
    expect(new Set(keys).size).toBe(keys.length)
    // Waivers are keyed the same way, so the excluded list must be collision-free too.
    const allKeys = [...keys, ...result.excluded.map((v) => v.key)]
    expect(new Set(allKeys).size).toBe(allKeys.length)
  })
})
