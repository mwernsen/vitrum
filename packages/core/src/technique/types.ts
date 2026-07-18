import type { BBox, Vec2 } from '@vitrum/geometry'

import type { PieceId } from '../pieces'

/**
 * Technique model (F-021): the technique-aware geometry that turns the abstract lead-line network
 * + detected pieces into **cut contours** — where the glass actually gets cut, given lead came or
 * copper foil. This is `packages/core`'s pure/geometry half of the feature; the *persisted* shape
 * (the came library, per-segment overrides, defaults, commands) lives in `@vitrum/model`. The
 * interfaces here mirror `@vitrum/model`'s technique types structurally so a model
 * `TechniqueSettings` value is accepted verbatim, keeping `core` document-independent — the same
 * split F-020 uses between `Piece` and `PieceSegment`.
 *
 * Everything is plain data plus free functions: no DOM, no Svelte, no `@vitrum/model` import.
 */

export type TechniqueKind = 'lead' | 'foil'
export type CameKind = 'H' | 'U'
export type SolderFinish = 'silver' | 'copper' | 'black'

/** A came profile as detection/offsetting sees it (mirror of `@vitrum/model`'s `CameProfile`). */
export interface CameProfile {
  readonly id: string
  readonly name: string
  readonly kind: CameKind
  readonly flangeMm: number
  readonly heartMm: number
}

/** A per-segment came override (mirror of `@vitrum/model`'s `CameOverride`). */
export interface CameOverride {
  readonly profileId?: string
  readonly flangeMm?: number
  readonly heartMm?: number
}

export interface LeadSettings {
  readonly defaultProfileId: string
  readonly cuttingToleranceMm: number
  readonly profiles: Readonly<Record<string, CameProfile>>
  readonly overrides: Readonly<Record<string, CameOverride>>
}

export interface FoilSettings {
  readonly foilWidthMm: number
  readonly pieceGapMm: number
  readonly solderFinish: SolderFinish
}

/** Structural view of a project's technique settings (mirror of `@vitrum/model`'s type). */
export interface TechniqueSettings {
  readonly kind: TechniqueKind
  readonly lead: LeadSettings
  readonly foil: FoilSettings
}

/**
 * The technique-derived cut contour for one piece: the piece boundary inset by the per-edge
 * allowance the technique implies. `ring`/`holeRings` are the closed inset polygons (mm), ready
 * for validation, the dev overlay, and downstream export (F-042/F-043). `degenerate` marks a piece
 * too small to inset — reported as data for DRC (F-031), never silently dropped (FR-3).
 */
export interface CutContour {
  readonly pieceId: PieceId
  readonly ring: readonly Vec2[]
  readonly holeRings: readonly (readonly Vec2[])[]
  readonly area: number
  readonly bbox: BBox
  /** True when insetting folded the contour through itself (piece too small for the came/foil). */
  readonly degenerate: boolean
}
