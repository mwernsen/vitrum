import { synthesizeNodes } from './nodes'
import { defaultTechnique, type TechniqueKind, type TechniqueSettings } from './technique'
import {
  defaultBomSettings,
  defaultLightSettings,
  defaultNestingSettings,
  defaultNumbering,
  defaultQuoteSettings,
  defaultRenderSettings,
  defaultSymmetry,
  type BomSettings,
  type DrcState,
  type Glass,
  type LightSettings,
  type NestingSettings,
  type NumberingState,
  type Project,
  type QuoteSettings,
  type RenderSettings,
  type ReinforcementBar,
  type Segment,
  type SymmetrySetup,
} from './types'

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
export const CURRENT_SCHEMA_VERSION = 15

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

/**
 * v3 → v4 (F-022): the rich glass catalog. v3 files carry `glasses` keyed by a placeholder
 * `{ id, name }` (never populated before F-022, since no glass command existed). Expand each entry
 * to the full `Glass` shape, filling colour/transparency/texture/thickness defaults so the file
 * loads cleanly; any already-rich field a pre-release file might carry is preserved.
 */
const migrateV3ToV4: Migration = {
  from: 3,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'glasses'> & {
      glasses?: Record<string, Partial<Glass> & { id: string; name: string }>
    }
    const glasses: Record<string, Glass> = {}
    for (const [id, g] of Object.entries(project.glasses ?? {})) {
      glasses[id] = {
        id: g.id ?? id,
        name: g.name ?? 'Untitled glass',
        color: g.color ?? '#cccccc',
        transparency: g.transparency ?? 'transparent',
        texture: g.texture ?? 'smooth',
        thicknessMm: g.thicknessMm ?? 3,
        ...(g.manufacturer !== undefined ? { manufacturer: g.manufacturer } : {}),
        ...(g.sku !== undefined ? { sku: g.sku } : {}),
        ...(g.pricePerM2 !== undefined ? { pricePerM2: g.pricePerM2 } : {}),
        ...(g.sheetSizes !== undefined ? { sheetSizes: g.sheetSizes } : {}),
        ...(g.swatch !== undefined ? { swatch: g.swatch } : {}),
      }
    }
    return { schemaVersion: 4, project: { ...project, glasses } }
  },
}

/**
 * v4 → v5 (F-023): glass assignments. v4 files have no `assignments` map; add an empty one so a
 * pre-F-023 project loads cleanly with every piece unassigned. Any assignments a pre-release v4
 * file might carry are preserved.
 */
const migrateV4ToV5: Migration = {
  from: 4,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'assignments'> & {
      assignments?: Record<string, string>
    }
    return {
      schemaVersion: 5,
      project: { ...project, assignments: project.assignments ?? {} },
    }
  },
}

/**
 * v5 → v6 (F-030): design-rule state. v5 files have no `drc` block; add an empty one so a
 * pre-F-030 project loads with every rule at its default severity and nothing waived. Any
 * `drc` a pre-release v5 file might carry is preserved, with its two maps defaulted.
 */
const migrateV5ToV6: Migration = {
  from: 5,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'drc'> & {
      drc?: Partial<DrcState>
    }
    const drc: DrcState = {
      exclusions: project.drc?.exclusions ?? {},
      rules: project.drc?.rules ?? {},
    }
    return { schemaVersion: 6, project: { ...project, drc } }
  },
}

/**
 * v6 → v7 (F-032): reinforcement bars. v6 files have no `reinforcements` list; add an empty one so
 * a pre-F-032 project loads with no bars placed. Any bars a pre-release v6 file might carry are
 * preserved.
 */
const migrateV6ToV7: Migration = {
  from: 6,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'reinforcements'> & {
      reinforcements?: readonly ReinforcementBar[]
    }
    return {
      schemaVersion: 7,
      project: { ...project, reinforcements: project.reinforcements ?? [] },
    }
  },
}

/**
 * v7 → v8 (F-040): piece numbering. v7 files have no `numbering` block; add the default (grouped-by-
 * glass, nothing numbered yet) so a pre-F-040 project loads with every piece unnumbered until the
 * first renumber. Any `numbering` a pre-release v7 file might carry is preserved, with its fields
 * defaulted.
 */
const migrateV7ToV8: Migration = {
  from: 7,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'numbering'> & {
      numbering?: Partial<NumberingState>
    }
    const base = defaultNumbering()
    const prior = project.numbering
    const numbering: NumberingState = {
      scheme: prior?.scheme ?? base.scheme,
      glassCodes: prior?.glassCodes ?? base.glassCodes,
      auto: prior?.auto ?? base.auto,
      overrides: prior?.overrides ?? base.overrides,
    }
    return { schemaVersion: 8, project: { ...project, numbering } }
  },
}

/**
 * v8 → v9 (F-042): cutting-list / BOM estimation factors. v8 files have no `bom` block; add the
 * default factors (glass +30%, came/foil +10%, solder 20 g/m, foil roll 33 m) so a pre-F-042 project
 * loads with the shipped estimation defaults. Any partial `bom` a pre-release v8 file might carry is
 * preserved, with its fields defaulted.
 */
const migrateV8ToV9: Migration = {
  from: 8,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'bom'> & { bom?: Partial<BomSettings> }
    const base = defaultBomSettings()
    const prior = project.bom
    const bom: BomSettings = {
      glassWaste: prior?.glassWaste ?? base.glassWaste,
      leadWaste: prior?.leadWaste ?? base.leadWaste,
      solderGramsPerMetre: prior?.solderGramsPerMetre ?? base.solderGramsPerMetre,
      foilRollLengthMm: prior?.foilRollLengthMm ?? base.foilRollLengthMm,
    }
    return { schemaVersion: 9, project: { ...project, bom } }
  },
}

/**
 * v9 → v10 (F-051): reference-image underlay layers gained real fields (assetId, quads, opacity,
 * desaturate, locked, rectified). Before F-051 the `layers` list was an unpopulated placeholder, so
 * any v9 file has `layers: []`; ensure the list is present. Any pre-release layer that predates the
 * full shape is dropped rather than half-migrated — its image bytes were never embedded, so it could
 * not render anyway.
 */
const migrateV9ToV10: Migration = {
  from: 9,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'layers'> & {
      layers?: readonly { readonly assetId?: unknown }[]
    }
    const layers = (project.layers ?? []).filter((l) => typeof l.assetId === 'string')
    return { schemaVersion: 10, project: { ...project, layers } as unknown as Project }
  },
}

/**
 * v10 → v11 (F-052): live-symmetry setup. v10 files have no `symmetry` block; add the inert default
 * (`mode: 'none'`) so a pre-F-052 project loads with no replication. Any partial `symmetry` a
 * pre-release v10 file might carry is preserved, with its fields defaulted.
 */
const migrateV10ToV11: Migration = {
  from: 10,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'symmetry'> & {
      symmetry?: Partial<SymmetrySetup>
    }
    const base = defaultSymmetry()
    const prior = project.symmetry
    const symmetry: SymmetrySetup = {
      mode: prior?.mode ?? base.mode,
      center: prior?.center ?? base.center,
      angle: prior?.angle ?? base.angle,
      count: prior?.count ?? base.count,
      mirror: prior?.mirror ?? base.mirror,
    }
    return { schemaVersion: 11, project: { ...project, symmetry } }
  },
}

/**
 * v11 → v12 (F-053): realistic-render settings. v11 files have no `render` block; add the default
 * (neutral full-intensity daylight, no per-piece texture placements) so a pre-F-053 project loads
 * with the shipped render defaults. Any partial `render` a pre-release v11 file might carry is
 * preserved, with its fields defaulted.
 */
const migrateV11ToV12: Migration = {
  from: 11,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'render'> & {
      render?: Partial<RenderSettings>
    }
    const base = defaultRenderSettings()
    const prior = project.render
    const render: RenderSettings = {
      backlightIntensity: prior?.backlightIntensity ?? base.backlightIntensity,
      backlightWarmth: prior?.backlightWarmth ?? base.backlightWarmth,
      textureTransforms: prior?.textureTransforms ?? base.textureTransforms,
    }
    return { schemaVersion: 12, project: { ...project, render } }
  },
}

/**
 * v12 → v13 (F-054): sunlight-simulation settings. v12 files have no `light` block; add the default
 * (south-facing Amsterdam window at midsummer noon) so a pre-F-054 project loads with the shipped
 * light setup. Any partial `light` a pre-release v12 file might carry is preserved, its fields
 * defaulted.
 */
const migrateV12ToV13: Migration = {
  from: 12,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'light'> & {
      light?: Partial<LightSettings>
    }
    const light: LightSettings = { ...defaultLightSettings(), ...project.light }
    return { schemaVersion: 13, project: { ...project, light } }
  },
}

/**
 * v13 → v14 (F-056): cost-estimation / quoting intent. v13 files have no `quote` block; add the
 * shipped defaults (EUR, placeholder price book + labor model, 15% overhead, 30% margin, empty
 * client fields and no manual lines) so a pre-F-056 project loads ready to quote. Any partial
 * `quote` a pre-release v13 file might carry is preserved, with its sub-objects defaulted.
 */
const migrateV13ToV14: Migration = {
  from: 13,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'quote'> & {
      quote?: Partial<QuoteSettings>
    }
    const base = defaultQuoteSettings()
    const prior = project.quote
    const quote: QuoteSettings = {
      currency: prior?.currency ?? base.currency,
      priceBook: prior?.priceBook ?? base.priceBook,
      labor: prior?.labor ?? base.labor,
      overheadPct: prior?.overheadPct ?? base.overheadPct,
      marginPct: prior?.marginPct ?? base.marginPct,
      client: prior?.client ?? base.client,
      manualLines: prior?.manualLines ?? base.manualLines,
    }
    return { schemaVersion: 14, project: { ...project, quote } }
  },
}

/**
 * v14 → v15 (F-057): sheet-nesting intent. v14 files have no `nesting` block; add the shipped
 * defaults (3 mm cut allowance, seed 1, no per-glass overrides) so a pre-F-057 project loads ready to
 * nest. Any partial `nesting` a pre-release v14 file might carry is preserved, with its fields
 * defaulted.
 */
const migrateV14ToV15: Migration = {
  from: 14,
  migrate: (file) => {
    const project = file.project as Omit<Project, 'nesting'> & {
      nesting?: Partial<NestingSettings>
    }
    const base = defaultNestingSettings()
    const prior = project.nesting
    const nesting: NestingSettings = {
      spacingMm: prior?.spacingMm ?? base.spacingMm,
      seed: prior?.seed ?? base.seed,
      perGlass: prior?.perGlass ?? base.perGlass,
    }
    return { schemaVersion: 15, project: { ...project, nesting } }
  },
}

export const MIGRATIONS: readonly Migration[] = [
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
  migrateV5ToV6,
  migrateV6ToV7,
  migrateV7ToV8,
  migrateV8ToV9,
  migrateV9ToV10,
  migrateV10ToV11,
  migrateV11ToV12,
  migrateV12ToV13,
  migrateV13ToV14,
  migrateV14ToV15,
]

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
