import type { CameProfile, TechniqueSettings } from './types'

/**
 * Allowance resolution (F-021): how far each drawn boundary edge is cut back to leave room for the
 * lead came heart or the copper-foil gap. Pure functions over a technique-settings view and a
 * segment id — the per-edge distances the cut-contour offsetter consumes.
 */

/** The effective came dimensions on a segment: its profile, with any per-segment override applied. */
export interface ResolvedCame {
  readonly profileId: string
  readonly name: string
  readonly kind: CameProfile['kind']
  readonly flangeMm: number
  readonly heartMm: number
}

/**
 * Resolve the came acting on one segment: start from the segment's profile (its override's
 * `profileId`, else the library default), then layer any raw dimension overrides on top. Falls back
 * to the default profile if a referenced profile id is missing (e.g. a profile was removed while an
 * override still named it), so resolution never throws on a live document.
 */
export function resolveCame(technique: TechniqueSettings, segmentId: string): ResolvedCame {
  const lead = technique.lead
  const override = lead.overrides[segmentId]
  const profileId = override?.profileId ?? lead.defaultProfileId
  const profile = lead.profiles[profileId] ?? lead.profiles[lead.defaultProfileId]
  const base: Pick<ResolvedCame, 'profileId' | 'name' | 'kind' | 'flangeMm' | 'heartMm'> = profile
    ? {
        profileId: profile.id,
        name: profile.name,
        kind: profile.kind,
        flangeMm: profile.flangeMm,
        heartMm: profile.heartMm,
      }
    : { profileId, name: profileId, kind: 'H', flangeMm: 0, heartMm: 0 }
  return {
    ...base,
    flangeMm: override?.flangeMm ?? base.flangeMm,
    heartMm: override?.heartMm ?? base.heartMm,
  }
}

/**
 * The inward cut allowance (mm) for a boundary edge belonging to `segmentId`:
 * - **lead**: half the (possibly overridden) came heart plus the cutting tolerance, so two pieces
 *   sharing a came both cut back by the same amount and the heart fits between them.
 * - **foil**: half the piece gap, so neighbouring foiled pieces end up a gap apart.
 *
 * Result is `≥ 0`; a nonsensical negative parameter clamps to 0 rather than growing the piece.
 */
export function edgeAllowanceMm(technique: TechniqueSettings, segmentId: string): number {
  if (technique.kind === 'foil') {
    return Math.max(0, technique.foil.pieceGapMm / 2)
  }
  const came = resolveCame(technique, segmentId)
  return Math.max(0, came.heartMm / 2 + technique.lead.cuttingToleranceMm)
}

/**
 * The came flange width (mm) acting on a segment — the true visual line weight for lead work, so
 * heavier perimeter came shows as a thicker line. Only meaningful in lead mode; foil designs render
 * as thin solder lines and don't scale their line weight with a flange (the renderer handles that).
 */
export function leadFlangeMm(technique: TechniqueSettings, segmentId: string): number {
  return resolveCame(technique, segmentId).flangeMm
}
