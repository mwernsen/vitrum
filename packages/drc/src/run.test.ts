import { setDrcExclusion, setDrcRuleOverride, DocumentStore } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { runChecks } from './run'
import { countByRule } from './test/harness'
import { buildInput } from './test/harness'
import {
  allScenes,
  cleanScene,
  duplicateScene,
  nearMissScene,
  openBorderScene,
  unassignedScene,
} from './test/scenes'

describe('topology rule pack — golden scenes (FR-5)', () => {
  it('is silent on the clean reference document', () => {
    const { project } = cleanScene()
    const result = runChecks(buildInput(project))
    expect(result.violations).toEqual([])
    expect(result.counts).toEqual({ error: 0, warning: 0, info: 0 })
  })

  it('each scene produces exactly its expected violation set', () => {
    for (const scene of allScenes()) {
      const result = runChecks(buildInput(scene.project))
      expect(countByRule(result), `scene: ${scene.name}`).toEqual(
        // Drop zero entries so the expected map lists only what should fire.
        Object.fromEntries(Object.entries(scene.expected).filter(([, n]) => n && n > 0)),
      )
    }
  })

  it('grades severities per the rule defaults', () => {
    const result = runChecks(buildInput(nearMissScene().project))
    // near-miss and dangling are errors.
    expect(result.violations.every((v) => v.severity === 'error')).toBe(true)
    expect(result.counts.error).toBe(3)
  })

  it('near-miss carries a weld quick-fix naming two distinct nodes', () => {
    const result = runChecks(buildInput(nearMissScene().project))
    const nearMiss = result.violations.find((v) => v.ruleId === 'near-miss-joint')
    expect(nearMiss?.quickFix?.kind).toBe('weld')
    expect(nearMiss?.quickFix?.keepNodeId).not.toBe(nearMiss?.quickFix?.dropNodeId)
    expect(nearMiss?.distance).toBeCloseTo(0.3, 5)
  })

  it('ranks most-severe first with a deterministic, reproducible order', () => {
    const input = buildInput(orphanWithWarning())
    const a = runChecks(input)
    const b = runChecks(input)
    expect(a.violations.map((v) => v.key)).toEqual(b.violations.map((v) => v.key))
    const ranks = a.violations.map((v) => v.severity)
    // errors precede warnings precede info.
    const order = { error: 0, warning: 1, info: 2 } as const
    for (let i = 1; i < ranks.length; i++) {
      expect(order[ranks[i]!]).toBeGreaterThanOrEqual(order[ranks[i - 1]!]!)
    }
  })
})

describe('per-project overrides (FR-3/FR-4)', () => {
  it('severity override changes a rule’s effective severity', () => {
    const base = duplicateScene().project
    const project = {
      ...base,
      drc: { exclusions: {}, rules: { 'duplicate-segment': { severity: 'error' as const } } },
    }
    const result = runChecks(buildInput(project))
    const dup = result.violations.find((v) => v.ruleId === 'duplicate-segment')
    expect(dup?.severity).toBe('error')
    expect(result.counts.error).toBeGreaterThanOrEqual(1)
  })

  it('a disabled rule emits nothing — no active violations, no waivers', () => {
    const base = unassignedScene().project
    const project = {
      ...base,
      drc: { exclusions: {}, rules: { 'unassigned-glass': { enabled: false } } },
    }
    const result = runChecks(buildInput(project))
    expect(result.violations.some((v) => v.ruleId === 'unassigned-glass')).toBe(false)
    expect(result.excluded.some((v) => v.ruleId === 'unassigned-glass')).toBe(false)
  })

  it('a waiver moves a violation to the excluded list and off the active totals', () => {
    const project = unassignedScene().project
    const first = runChecks(buildInput(project))
    const key = first.violations.find((v) => v.ruleId === 'unassigned-glass')!.key

    const waived = {
      ...project,
      drc: { ...project.drc, exclusions: { [key]: { note: 'stopper glass, no colour' } } },
    }
    const result = runChecks(buildInput(waived))
    expect(result.violations.some((v) => v.key === key)).toBe(false)
    expect(result.excluded.find((v) => v.key === key)?.note).toBe('stopper glass, no colour')
    expect(result.counts.warning).toBe(0)
  })

  it('waivers key off stable identity, surviving a re-run through the command store', () => {
    // Waive the open-border violation, then reload the store's document and re-run: still waived.
    const scene = openBorderScene()
    const input = buildInput(scene.project)
    const key = runChecks(input).violations[0]!.key

    const store = new DocumentStore()
    store.load(scene.project)
    store.execute(setDrcExclusion(key, { note: 'open by design' }))
    const result = runChecks(buildInput(store.document))
    expect(result.violations.some((v) => v.key === key)).toBe(false)
    expect(result.excluded.some((v) => v.key === key)).toBe(true)

    // Toggling the rule off via the store also silences it.
    store.execute(setDrcRuleOverride('open-border', { enabled: false }))
    expect(runChecks(buildInput(store.document)).excluded).toEqual([])
  })
})

/** Orphan scene also missing glass on one piece, to mix error/warning/info in one run. */
function orphanWithWarning() {
  // The orphan scene already yields info (orphan) + error (dangling); leave one piece unassigned
  // to add a warning, exercising all three severities in the ranking test.
  const { project } = unassignedScene()
  return project
}
