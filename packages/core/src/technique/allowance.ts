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

/**
 * What the panel's edge treatment adds **outside** the drawn line, per side.
 *
 * The drawn network is the came centreline, so the assembled panel is larger than the drawing: an
 * outward allowance in mm, plus the came that produced it when there is one. `mm` is `0` when the
 * edge treatment genuinely adds nothing (copper foil), and callers must not read that as "unknown".
 */
export interface PerimeterAllowance {
  /** Outward overhang beyond the drawn centreline, in mm, on every side. `≥ 0`. */
  readonly mm: number
  /** The came whose flange produced {@link mm}. Absent for foil, which has no perimeter came. */
  readonly came?: ResolvedCame
}

/** The came on a segment with no override at all — i.e. the library's default profile. */
function defaultCame(technique: TechniqueSettings): ResolvedCame {
  return resolveCame(technique, '')
}

/**
 * How far the finished panel reaches outside the drawn border, per side (F-021, for F-033's fit
 * check and the canvas panel frame). The drawn line is the came centreline, and the renderer draws
 * each came as a band of `flangeMm` centred on it, so:
 *
 * - **lead came**: the perimeter came's outer face lies half a flange outside the drawn border, and
 *   that face _is_ the panel's finished edge. The perimeter came is the came resolved on the
 *   `border`-role segments (heavier perimeter came is the standard case, F-021 FR-2); with several
 *   different ones the widest wins, so a rectangular estimate never under-states the finished size.
 *   With no border drawn yet the library default profile stands in.
 * - **copper foil**: there is no came. Each piece is cut back half the piece gap from the drawn
 *   line and the edge is then wrapped and soldered, so the finished edge lands back at the drawn
 *   line to within a fraction of a millimetre — the honest allowance is nothing, not a came number.
 *
 * A U-profile perimeter came actually overhangs less than half its flange (its channel opens inward,
 * so its back web sits nearer the glass edge), but F-021 deliberately deferred a U-specific
 * perimeter model and renders every came centred at flange width. Until that lands, the came band
 * the canvas draws is the authority here too, and the estimate errs generously.
 */
export function perimeterAllowance(
  technique: TechniqueSettings,
  borderSegmentIds: readonly string[] = [],
): PerimeterAllowance {
  if (technique.kind === 'foil') return { mm: 0 }
  let widest: ResolvedCame | undefined
  for (const id of borderSegmentIds) {
    const came = resolveCame(technique, id)
    if (!widest || came.flangeMm > widest.flangeMm) widest = came
  }
  const came = widest ?? defaultCame(technique)
  return { mm: Math.max(0, came.flangeMm / 2), came }
}
