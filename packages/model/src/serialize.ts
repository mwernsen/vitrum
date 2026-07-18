import { synthesizeNodes } from './nodes'
import { defaultTechnique, type TechniqueKind, type TechniqueSettings } from './technique'
import type { Project, Segment } from './types'

/**
 * Persistence (F-002). A `.vitrum` file is JSON: a small envelope carrying a
 * `schemaVersion` and the `Project`. Serialization is lossless — every entity id is part
 * of the data, so ids are stable across save/load (FR-6) and a save→load round-trip
 * reproduces the document exactly (FR-3).
 *
 * Loading is version-aware (FR-4): a file from a newer Vitrum than this build fails with
 * a clear, actionable error rather than importing a shape we don't understand; a file
 * from an older schema is upgraded by running the registered forward migrations in order.
 */
export const CURRENT_SCHEMA_VERSION = 3

/** On-disk envelope. `project` is the plain-JSON form of a `Project`. */
export interface VitrumFile {
  readonly schemaVersion: number
  readonly project: Project
}

/**
 * A forward migration: upgrades a file at version `from` to version `from + 1`. It must
 * return a file whose `schemaVersion` is exactly `from + 1`. The registry is empty until
 * the schema first changes; the mechanism is exercised by tests so it is ready when needed.
 */
export interface Migration {
  readonly from: number
  migrate(file: VitrumFile): VitrumFile
}

/**
 * v1 → v2 (F-013): the stored-node model. v1 files carry segments with no endpoint node
 * refs and no `nodes` map. Synthesise nodes by welding endpoints that share a coordinate
 * exactly — the same coincidence relation F-011/F-012 maintained at draw time — so every
 * junction that was value-equal becomes a shared node id, and the endpoint-integrity
 * invariant (FR-1) holds from the first load onward.
 */
const migrateV1ToV2: Migration = {
  from: 1,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'nodes' | 'segments'> & {
      segments: Record<string, Omit<Segment, 'endpoints'>>
    }
    const raw = Object.values(project.segments).map((s) => ({
      id: s.id,
      geometry: s.geometry,
      role: s.role,
    }))
    const { segments, nodes } = synthesizeNodes(raw)
    return { schemaVersion: 2, project: { ...project, segments, nodes } }
  },
}

/**
 * v2 → v3 (F-021): the technique model. v2 files carry a placeholder `technique: { kind }`. Expand
 * it into the full lead/foil parameter model, seeding the came library and defaults while
 * preserving the file's chosen `kind`. Any partial technique block a pre-release v2 file might
 * carry is layered over the defaults so no field is lost.
 */
const migrateV2ToV3: Migration = {
  from: 2,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'technique'> & {
      technique?: Partial<TechniqueSettings> & { kind?: TechniqueKind }
    }
    const base = defaultTechnique()
    const prior = project.technique
    const technique: TechniqueSettings = {
      kind: prior?.kind ?? base.kind,
      lead: prior?.lead ? { ...base.lead, ...prior.lead } : base.lead,
      foil: prior?.foil ? { ...base.foil, ...prior.foil } : base.foil,
    }
    return { schemaVersion: 3, project: { ...project, technique } }
  },
}

export const MIGRATIONS: readonly Migration[] = [migrateV1ToV2, migrateV2ToV3]

/** Thrown when a file was written by a newer Vitrum than this build can read (FR-4). */
export class SchemaVersionError extends Error {
  constructor(readonly fileVersion: number) {
    super(
      `This file uses schema version ${fileVersion}, but this version of Vitrum only ` +
        `understands up to ${CURRENT_SCHEMA_VERSION}. Update Vitrum to open it.`,
    )
    this.name = 'SchemaVersionError'
  }
}

/** Serialize a document to the `.vitrum` JSON string. */
export function serialize(doc: Project): string {
  const file: VitrumFile = { schemaVersion: CURRENT_SCHEMA_VERSION, project: doc }
  return JSON.stringify(file, null, 2)
}

/**
 * Parse a `.vitrum` JSON string back into a document, migrating older schema versions and
 * rejecting newer ones. `migrations` is injectable for testing; production uses the
 * registered `MIGRATIONS`.
 */
export function deserialize(text: string, migrations: readonly Migration[] = MIGRATIONS): Project {
  const file = parseFile(text)

  if (file.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new SchemaVersionError(file.schemaVersion)
  }

  let current = file
  while (current.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const migration = migrations.find((m) => m.from === current.schemaVersion)
    if (!migration) {
      throw new Error(
        `No migration registered from schema version ${current.schemaVersion}; cannot open file.`,
      )
    }
    const upgraded = migration.migrate(current)
    if (upgraded.schemaVersion !== current.schemaVersion + 1) {
      throw new Error(
        `Migration from schema version ${current.schemaVersion} produced version ` +
          `${upgraded.schemaVersion}; expected ${current.schemaVersion + 1}.`,
      )
    }
    current = upgraded
  }

  return current.project
}

function parseFile(text: string): VitrumFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new Error('Not a valid Vitrum file: the contents are not valid JSON.', { cause })
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { schemaVersion?: unknown }).schemaVersion !== 'number' ||
    typeof (parsed as { project?: unknown }).project !== 'object' ||
    (parsed as { project?: unknown }).project === null
  ) {
    throw new Error('Not a valid Vitrum file: missing schemaVersion or project.')
  }
  return parsed as VitrumFile
}
