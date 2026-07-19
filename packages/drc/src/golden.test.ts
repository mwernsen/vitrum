import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { deserialize } from '@vitrum/model'
import { describe, expect, it } from 'vitest'

import { runChecks } from './run'
import { buildInput, countByRule } from './test/harness'
import { allScenes } from './test/scenes'

/**
 * Golden-file suite (F-030 FR-5, technical guidance): the curated scenes are checked into the repo
 * as real `.vitrum` files. Each is loaded through the persistence path, run through detection + DRC,
 * and compared to its expected violation set — proving the engine reads a saved document and the
 * whole pipeline (serialize → migrate → detect → check) stays deterministic.
 */

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function loadFixture(name: string) {
  return deserialize(readFileSync(join(FIXTURE_DIR, `${name}.vitrum`), 'utf8'))
}

describe('golden .vitrum fixtures', () => {
  for (const scene of allScenes()) {
    it(`${scene.name}: loaded from disk, produces its expected violation set`, () => {
      const project = loadFixture(scene.name)
      const result = runChecks(buildInput(project))
      expect(countByRule(result)).toEqual(
        Object.fromEntries(Object.entries(scene.expected).filter(([, n]) => n && n > 0)),
      )
    })
  }

  it('the checked-in fixture matches the scene builder (regenerate if this fails)', () => {
    // A drift guard: the on-disk network must still be the one the builder describes, so the
    // expected sets above stay meaningful. Compares the loaded network to the builder's.
    for (const scene of allScenes()) {
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
