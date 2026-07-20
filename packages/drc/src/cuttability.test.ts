import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { deserialize, setDrcRuleOverride, DocumentStore } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { CUTTABILITY_RULES } from './rules/cuttability'
import { runChecks } from './run'
import {
  allCutScenes,
  concaveErrorScene,
  concaveWarnScene,
  tinyPieceErrorScene,
  tinyPieceFoilScene,
  tinyPieceScene,
} from './test/cuttabilityScenes'
import { buildInput, countByRule } from './test/harness'

/**
 * The cuttability pack (F-031). Each rule has one triggering scene and one just-inside-threshold
 * silent scene (FR-2); the two graded rules are checked at both severities; per-technique defaults
 * and per-project threshold overrides (FR-4) are exercised against the persistence commands.
 */

function cutCounts(project: Parameters<typeof buildInput>[0]) {
  return countByRule(runChecks(buildInput(project), CUTTABILITY_RULES))
}

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadFixture(name: string) {
  return deserialize(readFileSync(join(FIXTURE_DIR, `${name}.vitrum`), 'utf8'))
}

describe('cuttability golden .vitrum fixtures (FR-2)', () => {
  for (const scene of allCutScenes()) {
    it(`${scene.name}: loaded from disk, produces its expected violation set`, () => {
      const project = loadFixture(scene.name)
      const result = runChecks(buildInput(project), CUTTABILITY_RULES)
      expect(countByRule(result)).toEqual(
        Object.fromEntries(Object.entries(scene.expected).filter(([, n]) => n && n > 0)),
      )
    })
  }

  it('the checked-in fixtures match the scene builders (regenerate if this fails)', () => {
    // Drift guard: the on-disk network must still be the one the builder describes (arcs and all), so
    // the expected sets stay meaningful. Regenerate the fixtures from the scene builders if it fails.
    for (const scene of allCutScenes()) {
      const project = loadFixture(scene.name)
      expect(Object.keys(project.segments).length, scene.name).toBe(
        Object.keys(scene.project.segments).length,
      )
      expect(project.technique.kind, scene.name).toBe(scene.project.technique.kind)
    }
  })
})

describe('cuttability rules — scenes (FR-2)', () => {
  it('each scene produces exactly its expected violation set', () => {
    for (const scene of allCutScenes()) {
      expect(cutCounts(scene.project), `scene: ${scene.name}`).toEqual(
        Object.fromEntries(Object.entries(scene.expected).filter(([, n]) => n && n > 0)),
      )
    }
  })

  it('a well-drawn traditional panel is silent, a nasty one flags every defect (acceptance)', () => {
    const scenes = allCutScenes()
    const traditional = scenes.find((s) => s.name === 'cut-traditional')!
    const nasty = scenes.find((s) => s.name === 'cut-nasty')!
    expect(runChecks(buildInput(traditional.project), CUTTABILITY_RULES).violations).toEqual([])
    const nastyResult = runChecks(buildInput(nasty.project), CUTTABILITY_RULES)
    expect(
      nastyResult.violations.some((v) => v.ruleId === 'concave-notch' && v.severity === 'error'),
    ).toBe(true)
    expect(nastyResult.violations.some((v) => v.ruleId === 'sharp-point')).toBe(true)
  })
})

describe('cuttability rules — graded severity (the per-violation seam)', () => {
  it('min-piece-size is a warning above half the limit and an error below it', () => {
    const warn = runChecks(buildInput(tinyPieceScene().project), CUTTABILITY_RULES)
    const err = runChecks(buildInput(tinyPieceErrorScene().project), CUTTABILITY_RULES)
    expect(warn.violations.find((v) => v.ruleId === 'min-piece-size')?.severity).toBe('warning')
    expect(err.violations.find((v) => v.ruleId === 'min-piece-size')?.severity).toBe('error')
  })

  it('concave-curvature is a warning down to the hard radius and an error below it', () => {
    const warn = runChecks(buildInput(concaveWarnScene().project), CUTTABILITY_RULES)
    const err = runChecks(buildInput(concaveErrorScene().project), CUTTABILITY_RULES)
    expect(warn.violations.find((v) => v.ruleId === 'concave-curvature')?.severity).toBe('warning')
    expect(err.violations.find((v) => v.ruleId === 'concave-curvature')?.severity).toBe('error')
  })

  it('a message teaches with the measured value and the limit', () => {
    const err = runChecks(buildInput(concaveErrorScene().project), CUTTABILITY_RULES)
    const v = err.violations.find((v) => v.ruleId === 'concave-curvature')!
    expect(v.message).toMatch(/radius 5\.3 mm/)
    expect(v.message).toMatch(/minimum ~15\.0 mm/)
    expect(v.explain).toMatch(/score/i)
  })
})

describe('cuttability thresholds — per technique and per-project (FR-4)', () => {
  it('the size floor switches with technique: an 8 mm square warns under lead, is silent under foil', () => {
    expect(cutCounts(tinyPieceScene().project)['min-piece-size']).toBe(1)
    expect(cutCounts(tinyPieceFoilScene().project)['min-piece-size']).toBeUndefined()
  })

  it('a per-project threshold override pins a value that wins over the default', () => {
    // Lower the lead size floor to 5 mm: the 8 mm square (6.5 mm inset) is now within spec → silent.
    const store = new DocumentStore()
    store.load(tinyPieceScene().project)
    store.execute(setDrcRuleOverride('min-piece-size', { thresholds: { minDimensionMm: 5 } }))
    expect(cutCounts(store.document)['min-piece-size']).toBeUndefined()

    // Raising it above the inset size brings the warning back.
    store.execute(setDrcRuleOverride('min-piece-size', { thresholds: { minDimensionMm: 20 } }))
    expect(cutCounts(store.document)['min-piece-size']).toBe(1)
  })

  it('a severity override still wins over a rule’s own escalation', () => {
    // min-piece-size would grade the 4 mm square as an error; an explicit info override caps it.
    const base = tinyPieceErrorScene().project
    const project = {
      ...base,
      drc: { exclusions: {}, rules: { 'min-piece-size': { severity: 'info' as const } } },
    }
    const v = runChecks(buildInput(project), CUTTABILITY_RULES).violations.find(
      (v) => v.ruleId === 'min-piece-size',
    )
    expect(v?.severity).toBe('info')
  })
})
