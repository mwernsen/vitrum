import { describe, expect, it } from 'vitest'

import { runChecks } from './run'
import { buildInput } from './test/harness'
import { gridProject } from './test/scenes'

/**
 * FR-1 benchmark: a full run on the ~200-piece reference document completes well under 500 ms. The
 * DRC pass itself is timed (detection is precomputed, as in the app where pieces come from F-020's
 * incremental detector); the worker adapter in `packages/ui` is what keeps this off the draw thread.
 */
describe('performance (FR-1)', () => {
  it('runs the ~200-piece grid in under 500 ms', () => {
    const project = gridProject(14)
    const input = buildInput(project)
    expect(input.pieces.length).toBeGreaterThanOrEqual(180)

    const start = performance.now()
    const runs = 5
    for (let i = 0; i < runs; i++) runChecks(input)
    const perRun = (performance.now() - start) / runs

    expect(perRun).toBeLessThan(500)
  })
})
