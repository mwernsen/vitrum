import { line, vec2 } from '@vitrum/geometry'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { projectArb } from './arbitraries'
import { createSegment } from './factory'
import {
  CURRENT_SCHEMA_VERSION,
  deserialize,
  SchemaVersionError,
  serialize,
  type Migration,
} from './serialize'
import { createEmptyProject } from './types'

describe('serialize / deserialize round-trip (FR-3, FR-6)', () => {
  it('round-trips an arbitrary project losslessly', () => {
    fc.assert(
      fc.property(projectArb, (project) => {
        expect(deserialize(serialize(project))).toEqual(project)
      }),
    )
  })

  it('preserves entity ids across save/load (FR-6)', () => {
    const project = createEmptyProject({ name: 'Ids' })
    const a = createSegment(line(vec2(0, 0), vec2(1, 0)), 'lead')
    const b = createSegment(line(vec2(1, 0), vec2(1, 1)), 'border')
    const withSegments = { ...project, segments: { [a.id]: a, [b.id]: b } }

    const reloaded = deserialize(serialize(withSegments))
    expect(Object.keys(reloaded.segments).sort()).toEqual([a.id, b.id].sort())
    expect(reloaded.segments[a.id]).toEqual(a)
    expect(reloaded.segments[b.id]).toEqual(b)
  })

  it('writes the current schema version in the envelope', () => {
    const file = JSON.parse(serialize(createEmptyProject())) as { schemaVersion: number }
    expect(file.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })
})

describe('schema versioning (FR-4)', () => {
  it('rejects a file from a newer schema version with a clear error', () => {
    const future = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      project: createEmptyProject(),
    })
    expect(() => deserialize(future)).toThrow(SchemaVersionError)
    expect(() => deserialize(future)).toThrow(/Update Vitrum/)
  })

  it('runs a chain of registered forward migrations for an older schema version', () => {
    // A synthetic v0 file; the injected chain must reach CURRENT_SCHEMA_VERSION (2).
    const legacy = JSON.stringify({
      schemaVersion: 0,
      project: { ...createEmptyProject({ name: 'legacy-name' }) },
    })
    const migrations: Migration[] = [
      {
        from: 0,
        migrate: (file) => ({
          schemaVersion: 1,
          project: { ...file.project, settings: { ...file.project.settings, name: 'migrated' } },
        }),
      },
      { from: 1, migrate: (file) => ({ schemaVersion: 2, project: file.project }) },
    ]
    const project = deserialize(legacy, migrations)
    expect(project.settings.name).toBe('migrated')
  })

  it('v1 → v2 synthesises shared nodes from coincident endpoints (F-013)', () => {
    // A legacy v1 file: segments with no endpoint node refs, no `nodes` map. Two spans meet
    // at (100, 0), so the migration must weld them onto one shared node.
    const legacyProject = {
      settings: { units: 'mm', name: 'legacy' },
      technique: { kind: 'lead' },
      segments: {
        s1: { id: 's1', geometry: line(vec2(0, 0), vec2(100, 0)), role: 'lead' },
        s2: { id: 's2', geometry: line(vec2(100, 0), vec2(100, 80)), role: 'lead' },
      },
      glasses: {},
      layers: [],
    }
    const project = deserialize(JSON.stringify({ schemaVersion: 1, project: legacyProject }))
    // Three distinct endpoints → three nodes; s1.end and s2.start weld to the same id.
    expect(Object.keys(project.nodes)).toHaveLength(3)
    expect(project.segments.s1!.endpoints[1]).toBe(project.segments.s2!.endpoints[0])
    expect(project.nodes[project.segments.s1!.endpoints[1]]!.pos).toEqual(vec2(100, 0))
  })

  it('throws when no migration path exists for an older version', () => {
    const legacy = JSON.stringify({ schemaVersion: 0, project: createEmptyProject() })
    expect(() => deserialize(legacy, [])).toThrow(/No migration registered/)
  })

  it('rejects a migration that fails to advance the version exactly one step', () => {
    const legacy = JSON.stringify({ schemaVersion: 0, project: createEmptyProject() })
    const bad: Migration[] = [{ from: 0, migrate: (file) => ({ ...file, schemaVersion: 5 }) }]
    expect(() => deserialize(legacy, bad)).toThrow(/expected 1/)
  })
})

describe('parse errors', () => {
  it('rejects non-JSON input', () => {
    expect(() => deserialize('not json {')).toThrow(/not valid JSON/)
  })

  it('rejects JSON missing the envelope fields', () => {
    expect(() => deserialize(JSON.stringify({ foo: 1 }))).toThrow(/missing schemaVersion/)
  })
})
