import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { deserialize } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { STRUCTURAL_RULES } from './rules/structural'
import { runChecks } from './run'
import { buildInput, countByRule } from './test/harness'
import { structuralScenes } from './test/structuralScenes'

/**
 * On-disk golden suite for the structural pack (F-032), mirroring the topology/cuttability fixtures:
 * the headline scenes are checked in as real `.vitrum` files, loaded through the persistence path
 * (serialize → migrate → detect → check) and compared to the builder. This also proves the
 * reinforcement bar entity round-trips through save/load and clears the rule after a cold reload
 * (FR-2 "serialized … and consumed by `panel-needs-reinforcement`").
 */

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadFixture(name: string) {
  return deserialize(readFileSync(join(FIXTURE_DIR, `${name}.vitrum`), 'utf8'))
}

describe('structural golden .vitrum fixtures', () => {
  for (const scene of structuralScenes()) {
    it(`${scene.name}: loaded from disk, headline rule count is ${scene.count}`, () => {
      const project = loadFixture(scene.name)
      const result = runChecks(buildInput(project), STRUCTURAL_RULES)
      expect(countByRule(result)[scene.headline] ?? 0).toBe(scene.count)
    })
  }

  it('the braced fixture carries its reinforcement bar across a reload', () => {
    const project = loadFixture('struct-braced')
    expect(project.reinforcements).toHaveLength(1)
    expect(project.reinforcements[0]!.material).toBe('zinc')
  })

  it('the checked-in network matches the scene builder (regenerate if this fails)', () => {
    for (const scene of structuralScenes()) {
      const project = loadFixture(scene.name)
      expect(Object.keys(project.segments).length, scene.name).toBe(
        Object.keys(scene.project.segments).length,
      )
      expect(project.reinforcements.length, scene.name).toBe(scene.project.reinforcements.length)
    }
  })
})
