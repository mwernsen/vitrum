import type { Project } from './types'

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
export const CURRENT_SCHEMA_VERSION = 1

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

export const MIGRATIONS: readonly Migration[] = []

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
