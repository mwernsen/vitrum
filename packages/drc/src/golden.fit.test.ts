import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { deserialize } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { FIT_RULES } from './rules/fit'
import { runChecks } from './run'
import { buildInput, countByRule } from './test/harness'
import { fitScenes } from './test/fitScenes'

/**
 * On-disk golden suite for the panel-fit pack (F-033), mirroring the topology/cuttability/structural
 * fixtures: each scene is checked in as a real `.vitrum` file, loaded through the persistence path
 * (serialize → migrate → detect → check) and compared to the builder. Because this pack's whole
 * reference is `settings.panelSize`, that also proves the ordered size survives save/load and still
 * grades the design after a cold reload — including `fit-drawn-to-size`, the border drawn to exactly
 * the ordered size, which is an error only because `panelSize` means the *finished* panel
 * (2026-08-16) and the came lands outside the drawn line.
 */

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadFixture(name: string) {
  return deserialize(readFileSync(join(FIXTURE_DIR, `${name}.vitrum`), 'utf8'))
}

describe('panel-fit golden .vitrum fixtures', () => {
  for (const scene of fitScenes()) {
    it(`${scene.name}: loaded from disk, headline rule count is ${scene.count}`, () => {
      const project = loadFixture(scene.name)
      const result = runChecks(buildInput(project), FIT_RULES)
      expect(countByRule(result)[scene.headline] ?? 0).toBe(scene.count)
      if (scene.severity) {
        expect(result.violations[0]!.severity).toBe(scene.severity)
      }
    })
  }

  it('the ordered panel size survives the reload', () => {
    for (const scene of fitScenes()) {
      expect(loadFixture(scene.name).settings.panelSize, scene.name).toEqual({
        width: 300,
        height: 400,
      })
    }
  })

  it('the checked-in network matches the scene builder (regenerate if this fails)', () => {
    for (const scene of fitScenes()) {
      const project = loadFixture(scene.name)
      expect(Object.keys(project.segments).length, scene.name).toBe(
        Object.keys(scene.project.segments).length,
      )
      expect(Object.keys(project.nodes).length, scene.name).toBe(
        Object.keys(scene.project.nodes).length,
      )
    }
  })
})
