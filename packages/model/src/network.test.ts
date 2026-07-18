import { line, vec2 } from '@vitrum/geometry'
import { describe, expect, it } from 'vitest'

import { addSegments } from './commands'
import { createSegment } from './factory'
import { constructionSegmentIds, isOutputSegment, outputSegments } from './network'
import { createEmptyProject } from './types'

function projectWith(...roles: ('lead' | 'border' | 'construction')[]) {
  const segments = roles.map((role, i) => createSegment(line(vec2(i, 0), vec2(i, 10)), role))
  return { project: addSegments(segments).apply(createEmptyProject()), segments }
}

describe('network — construction exclusion (F-012 FR-5)', () => {
  it('excludes construction segments from the output network', () => {
    const { project } = projectWith('lead', 'construction', 'border', 'construction')
    const output = outputSegments(project)
    expect(output).toHaveLength(2)
    expect(output.every((s) => s.role !== 'construction')).toBe(true)
  })

  it('keeps lead and border segments in the output network', () => {
    const { project } = projectWith('lead', 'border')
    expect(outputSegments(project)).toHaveLength(2)
  })

  it('classifies segments individually', () => {
    const { segments } = projectWith('lead', 'construction', 'border')
    expect(isOutputSegment(segments[0]!)).toBe(true)
    expect(isOutputSegment(segments[1]!)).toBe(false)
    expect(isOutputSegment(segments[2]!)).toBe(true)
  })

  it('lists exactly the construction ids for the clear-all-guides command', () => {
    const { project, segments } = projectWith('lead', 'construction', 'construction')
    const ids = constructionSegmentIds(project)
    expect(ids).toHaveLength(2)
    expect(ids).toContain(segments[1]!.id)
    expect(ids).toContain(segments[2]!.id)
    expect(ids).not.toContain(segments[0]!.id)
  })
})
