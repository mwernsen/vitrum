import type { SegmentId } from './types'

/**
 * The physical construction model (F-021): is this panel leaded (came) or copper-foiled
 * (Tiffany), and what that implies for how lines render and — critically — where the glass
 * actually gets cut. This module owns the *persisted* shape (it is serialized into the
 * `.vitrum` file and, later, exported by F-042/F-043) plus the seed came library and the
 * commands that edit it. The technique-aware geometry (per-edge cut-contour offsetting) lives
 * in `@vitrum/core/technique`, which mirrors these types structurally so `packages/core` stays
 * document-independent — the same split F-020 uses between `Piece`/`PieceSegment`.
 *
 * Everything here is plain, deeply-readonly data. Mutation happens only through the commands
 * at the bottom of the file (applied by the store), never by writing to these objects.
 */

/** Which construction technique the whole panel uses. */
export type TechniqueKind = 'lead' | 'foil'

/** Came profile cross-section: `H` holds two pieces (interior + perimeter); `U` is perimeter only. */
export type CameKind = 'H' | 'U'

/** Solder bead finish for copper-foil work — a rendering/BOM concern (used fully by F-053). */
export type SolderFinish = 'silver' | 'copper' | 'black'

/** A stable id for a came profile in the project's library. Seeds use readable slugs. */
export type CameProfileId = string

/**
 * One entry in the editable came profile library (KiCad-footprint-lib style). `flangeMm` is the
 * visible face width; `heartMm` is the core web between pieces and is what drives the cut inset
 * (glass is cut back by half the heart). Authored and displayed in mm.
 */
export interface CameProfile {
  readonly id: CameProfileId
  readonly name: string
  readonly kind: CameKind
  readonly flangeMm: number
  readonly heartMm: number
}

/**
 * A per-segment came override (heavier perimeter came is the standard case). Either swap the
 * whole profile (`profileId`) and/or override raw dimensions on top. An empty override is a
 * no-op; `setCameOverride(id, null)` clears it.
 */
export interface CameOverride {
  readonly profileId?: CameProfileId
  readonly flangeMm?: number
  readonly heartMm?: number
}

/** Lead-came parameters. `overrides` is keyed by segment id (per-segment came, F-021 FR-2). */
export interface LeadSettings {
  readonly defaultProfileId: CameProfileId
  /** Extra cut-back beyond half the heart, in mm (cutting slack). Default 0. */
  readonly cuttingToleranceMm: number
  /** The project-local came library, seeded from {@link SEED_CAME_PROFILES}, freely editable. */
  readonly profiles: Readonly<Record<CameProfileId, CameProfile>>
  /** Per-segment came overrides, keyed by segment id. */
  readonly overrides: Readonly<Record<SegmentId, CameOverride>>
}

/** Copper-foil parameters. Foil is sold in fractional inches; stored in mm like all geometry. */
export interface FoilSettings {
  /** Foil width as sold (mm). Default 5.6 mm ≈ 7/32". */
  readonly foilWidthMm: number
  /** Total gap between neighbouring pieces (mm); each piece insets by half of it. Default 0.8. */
  readonly pieceGapMm: number
  readonly solderFinish: SolderFinish
}

/**
 * The whole technique model. Both `lead` and `foil` parameter blocks are always present so a
 * technique switch (`kind` flip) preserves the other technique's parameters and is one undo
 * step (FR-4). Serialization is stable: new parameters are added via a schema migration
 * (F-002), never by changing the meaning of an existing field.
 */
export interface TechniqueSettings {
  readonly kind: TechniqueKind
  readonly lead: LeadSettings
  readonly foil: FoilSettings
}

/**
 * The seed came profile library — common Regalead / DHD sizes shipped as data. New projects
 * start with a copy of these (they are editable per project); ids are stable readable slugs so
 * cross-project references and saved files stay meaningful. Flange is the visible face; heart is
 * the core web that drives the cut inset. Values are representative round-came/H sizes in mm.
 */
export const SEED_CAME_PROFILES: readonly CameProfile[] = [
  { id: 'came-h-4', name: 'H 4 mm', kind: 'H', flangeMm: 4, heartMm: 1.4 },
  { id: 'came-h-5', name: 'H 5 mm', kind: 'H', flangeMm: 5, heartMm: 1.5 },
  { id: 'came-h-6', name: 'H 6 mm', kind: 'H', flangeMm: 6, heartMm: 1.6 },
  { id: 'came-h-7', name: 'H 7 mm', kind: 'H', flangeMm: 7, heartMm: 1.7 },
  { id: 'came-h-9', name: 'H 9 mm', kind: 'H', flangeMm: 9, heartMm: 1.8 },
  { id: 'came-h-12', name: 'H 12 mm', kind: 'H', flangeMm: 12, heartMm: 2.0 },
  { id: 'came-u-6', name: 'U 6 mm (perimeter)', kind: 'U', flangeMm: 6, heartMm: 1.6 },
  { id: 'came-u-9', name: 'U 9 mm (perimeter)', kind: 'U', flangeMm: 9, heartMm: 1.8 },
]

/** The seed library as a keyed record — a fresh copy each call so no project shares an object. */
export function seedCameLibrary(): Record<CameProfileId, CameProfile> {
  const library: Record<CameProfileId, CameProfile> = {}
  for (const profile of SEED_CAME_PROFILES) library[profile.id] = { ...profile }
  return library
}

/** The default technique for a new project: lead, H 5 mm came, no cutting slack (FR-5). */
export function defaultTechnique(): TechniqueSettings {
  return {
    kind: 'lead',
    lead: {
      defaultProfileId: 'came-h-5',
      cuttingToleranceMm: 0,
      profiles: seedCameLibrary(),
      overrides: {},
    },
    foil: {
      foilWidthMm: 5.6, // 7/32"
      pieceGapMm: 0.8,
      solderFinish: 'silver',
    },
  }
}
