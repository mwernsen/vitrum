import type { DrcInput, RunResult, Violation } from '@vitrum/drc'
import { vec2 } from '@vitrum/geometry'
import { createEmptyProject, type Command } from '@vitrum/model'
import type { Scheduler } from '@vitrum/model'
import { describe, expect, it, vi } from 'vitest'

import { DrcController } from './controller.svelte'
import type { DrcRunner } from './runner'

/** A scheduler whose pending timers fire only when the test calls `flush`. */
class FakeScheduler implements Scheduler {
  #timers = new Map<number, () => void>()
  #id = 0
  setTimer(fn: () => void): number {
    const id = ++this.#id
    this.#timers.set(id, fn)
    return id
  }
  clearTimer(handle: unknown): void {
    this.#timers.delete(handle as number)
  }
  flush(): void {
    const fns = [...this.#timers.values()]
    this.#timers.clear()
    for (const fn of fns) fn()
  }
  get pending(): number {
    return this.#timers.size
  }
}

/** A runner that returns a canned result and records how many times it ran. */
function fakeRunner(result: RunResult) {
  const runner: DrcRunner & { calls: number } = {
    calls: 0,
    run: async () => {
      runner.calls += 1
      return result
    },
    dispose: () => {},
  }
  return runner
}

function violation(over: Partial<Violation> = {}): Violation {
  return {
    ruleId: 'near-miss-joint',
    title: 'Near-miss joint',
    severity: 'error',
    message: 'two endpoints are not welded',
    explain: 'weld it',
    at: vec2(10, 20),
    segmentIds: ['s1', 's2'],
    pieceIds: [],
    key: 'near-miss-joint#s1|s2',
    quickFix: { kind: 'weld', keepNodeId: 'n1', dropNodeId: 'n2', label: 'Weld it' },
    ...over,
  }
}

function result(violations: Violation[]): RunResult {
  return {
    violations,
    excluded: [],
    counts: {
      error: violations.filter((v) => v.severity === 'error').length,
      warning: violations.filter((v) => v.severity === 'warning').length,
      info: violations.filter((v) => v.severity === 'info').length,
    },
  }
}

const input: DrcInput = {
  project: createEmptyProject(),
  pieces: [],
  diagnostics: [],
  cutContours: [],
  assignedKeys: [],
}

describe('DrcController (F-030)', () => {
  it('debounces live runs: two schedules collapse into one run', async () => {
    const scheduler = new FakeScheduler()
    const runner = fakeRunner(result([violation()]))
    const drc = new DrcController({ runner, scheduler })

    drc.schedule(input)
    drc.schedule(input)
    expect(scheduler.pending).toBe(1) // the first timer was cleared

    scheduler.flush()
    await vi.waitFor(() => expect(drc.hasRun).toBe(true))
    expect(runner.calls).toBe(1)
    expect(drc.result.counts.error).toBe(1)
  })

  it('runNow bypasses the debounce and runs immediately', async () => {
    const scheduler = new FakeScheduler()
    const runner = fakeRunner(result([violation()]))
    const drc = new DrcController({ runner, scheduler })

    await drc.runNow(input)
    expect(runner.calls).toBe(1)
    expect(drc.markers).toHaveLength(1)
    expect(drc.markers[0]).toMatchObject({ severity: 'error', key: 'near-miss-joint#s1|s2' })
  })

  it('a stale run is ignored when a newer one supersedes it', async () => {
    const scheduler = new FakeScheduler()
    let resolveFirst: (r: RunResult) => void = () => {}
    const first = new Promise<RunResult>((r) => (resolveFirst = r))
    const runs = [first, Promise.resolve(result([violation({ key: 'k-new' })]))]
    let i = 0
    const runner: DrcRunner = { run: () => runs[i++]!, dispose: () => {} }
    const drc = new DrcController({ runner, scheduler })

    const p1 = drc.runNow(input)
    const p2 = drc.runNow(input)
    await p2
    // The second (newer) run has landed.
    expect(drc.result.violations[0]?.key).toBe('k-new')
    // Resolving the first (stale) run must not overwrite the newer result.
    resolveFirst(result([violation({ key: 'k-old' })]))
    await p1
    expect(drc.result.violations[0]?.key).toBe('k-new')
  })

  it('selecting a violation rings it and zooms to its location', async () => {
    const zoomTo = vi.fn<(at: { x: number; y: number }) => void>()
    const drc = new DrcController({ runner: fakeRunner(result([])), zoomTo })
    const v = violation()
    drc.select(v)
    expect(drc.selectedKey).toBe(v.key)
    expect(zoomTo).toHaveBeenCalledWith(v.at)
    drc.select(null)
    expect(drc.selectedKey).toBeNull()
  })

  it('waive, unwaive and quick-fix dispatch the right commands', () => {
    const commands: Command[] = []
    const drc = new DrcController({
      runner: fakeRunner(result([])),
      execute: (c) => commands.push(c),
    })
    const v = violation()

    drc.waive(v, '  by design  ')
    drc.unwaive(v.key)
    drc.applyQuickFix(v)
    drc.setRuleOverride('orphan-region', { enabled: false })

    expect(commands.map((c) => c.kind)).toEqual([
      'setDrcExclusion',
      'setDrcExclusion',
      'mergeNodes',
      'setDrcRuleOverride',
    ])
    // The waiver note is trimmed and stored on the document.
    const doc = commands[0]!.apply(createEmptyProject())
    expect(doc.drc.exclusions[v.key]).toEqual({ note: 'by design' })
  })
})
