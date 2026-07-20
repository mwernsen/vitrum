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
    // A synthetic v0 file; the injected chain must reach CURRENT_SCHEMA_VERSION.
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
      { from: 2, migrate: (file) => ({ schemaVersion: 3, project: file.project }) },
      { from: 3, migrate: (file) => ({ schemaVersion: 4, project: file.project }) },
      { from: 4, migrate: (file) => ({ schemaVersion: 5, project: file.project }) },
      { from: 5, migrate: (file) => ({ schemaVersion: 6, project: file.project }) },
      { from: 6, migrate: (file) => ({ schemaVersion: 7, project: file.project }) },
      { from: 7, migrate: (file) => ({ schemaVersion: 8, project: file.project }) },
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

  it('v2 → v3 expands the placeholder technique into the full lead/foil model (F-021)', () => {
    // A legacy v2 file carrying only the technique placeholder `{ kind: 'foil' }`.
    const legacyProject = {
      settings: { units: 'mm', name: 'legacy' },
      technique: { kind: 'foil' },
      segments: {},
      nodes: {},
      glasses: {},
      layers: [],
    }
    const project = deserialize(JSON.stringify({ schemaVersion: 2, project: legacyProject }))
    expect(project.technique.kind).toBe('foil') // chosen kind preserved
    expect(project.technique.lead.defaultProfileId).toBe('came-h-5')
    expect(project.technique.lead.profiles['came-h-5']).toBeDefined()
    expect(project.technique.foil.foilWidthMm).toBeCloseTo(5.6)
  })

  it('v3 → v4 expands placeholder glasses into the full catalog shape (F-022)', () => {
    // A legacy v3 file carrying a placeholder glass `{ id, name }` only.
    const legacyProject = {
      settings: { units: 'mm', name: 'legacy' },
      technique: { kind: 'lead' },
      segments: {},
      nodes: {},
      glasses: { g1: { id: 'g1', name: 'Old ruby' } },
      layers: [],
    }
    const project = deserialize(JSON.stringify({ schemaVersion: 3, project: legacyProject }))
    expect(project.glasses['g1']).toMatchObject({
      id: 'g1',
      name: 'Old ruby',
      color: expect.any(String),
      transparency: 'transparent',
      texture: 'smooth',
      thicknessMm: 3,
    })
  })

  it('v4 → v5 adds an empty assignments map (F-023)', () => {
    // A legacy v4 file with a rich glass but no assignments map.
    const legacyProject = {
      settings: { units: 'mm', name: 'legacy' },
      technique: { kind: 'lead' },
      segments: {},
      nodes: {},
      glasses: {
        g1: {
          id: 'g1',
          name: 'Ruby',
          color: '#900',
          transparency: 'transparent',
          texture: 'smooth',
          thicknessMm: 3,
        },
      },
      layers: [],
    }
    const project = deserialize(JSON.stringify({ schemaVersion: 4, project: legacyProject }))
    expect(project.assignments).toEqual({})
    // A pre-release v4 file carrying assignments keeps them.
    const withAssignments = deserialize(
      JSON.stringify({
        schemaVersion: 4,
        project: { ...legacyProject, assignments: { 'p-x': 'g1' } },
      }),
    )
    expect(withAssignments.assignments).toEqual({ 'p-x': 'g1' })
  })

  it('v5 → v6 adds an empty DRC state (F-030)', () => {
    // A legacy v5 file with assignments but no drc block.
    const legacyProject = {
      settings: { units: 'mm', name: 'legacy' },
      technique: { kind: 'lead' },
      segments: {},
      nodes: {},
      glasses: {},
      assignments: {},
      layers: [],
    }
    const project = deserialize(JSON.stringify({ schemaVersion: 5, project: legacyProject }))
    expect(project.drc).toEqual({ exclusions: {}, rules: {} })
    // A pre-release v5 file carrying drc state keeps it.
    const withDrc = deserialize(
      JSON.stringify({
        schemaVersion: 5,
        project: {
          ...legacyProject,
          drc: { exclusions: { 'near-miss-joint#s1|s2': { note: 'ok as drawn' } }, rules: {} },
        },
      }),
    )
    expect(withDrc.drc.exclusions['near-miss-joint#s1|s2']).toEqual({ note: 'ok as drawn' })
  })

  it('v6 → v7 adds an empty reinforcements list (F-032)', () => {
    // A legacy v6 file with a DRC block but no reinforcements list.
    const legacyProject = {
      settings: { units: 'mm', name: 'legacy' },
      technique: { kind: 'lead' },
      segments: {},
      nodes: {},
      glasses: {},
      assignments: {},
      layers: [],
      drc: { exclusions: {}, rules: {} },
    }
    const project = deserialize(JSON.stringify({ schemaVersion: 6, project: legacyProject }))
    expect(project.reinforcements).toEqual([])
    // A pre-release v6 file carrying bars keeps them.
    const withBars = deserialize(
      JSON.stringify({
        schemaVersion: 6,
        project: {
          ...legacyProject,
          reinforcements: [
            { id: 'r1', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, widthMm: 6, material: 'zinc' },
          ],
        },
      }),
    )
    expect(withBars.reinforcements).toHaveLength(1)
    expect(withBars.reinforcements[0]!.material).toBe('zinc')
  })

  it('v7 → v8 adds the default numbering state (F-040)', () => {
    // A legacy v7 file with reinforcements but no numbering block.
    const legacyProject = {
      settings: { units: 'mm', name: 'legacy' },
      technique: { kind: 'lead' },
      segments: {},
      nodes: {},
      glasses: {},
      assignments: {},
      layers: [],
      drc: { exclusions: {}, rules: {} },
      reinforcements: [],
    }
    const project = deserialize(JSON.stringify({ schemaVersion: 7, project: legacyProject }))
    expect(project.numbering).toEqual({
      scheme: 'grouped',
      glassCodes: {},
      auto: {},
      overrides: {},
    })
    // A pre-release v7 file carrying numbering keeps it.
    const withNumbering = deserialize(
      JSON.stringify({
        schemaVersion: 7,
        project: {
          ...legacyProject,
          numbering: { scheme: 'sequential', glassCodes: { g1: 'A' }, auto: { 'p-1': '1' } },
        },
      }),
    )
    expect(withNumbering.numbering.scheme).toBe('sequential')
    expect(withNumbering.numbering.glassCodes).toEqual({ g1: 'A' })
    expect(withNumbering.numbering.auto).toEqual({ 'p-1': '1' })
    // A missing sub-field (overrides) is defaulted.
    expect(withNumbering.numbering.overrides).toEqual({})
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
