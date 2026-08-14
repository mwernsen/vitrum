import type { Vec2 } from '@vitrum/geometry'

import type { CameRibbonInput } from './glass-gl'

/**
 * Where came runs meet, the craftsperson leaves a solder joint — a small hand-made lump, not a
 * mitred corner (F-064 thrust B, from Mathieu's reference photo of a real leaded panel). The
 * renderers draw a blob at each of these, so intersections read as soldered rather than as two
 * ribbons crossing.
 *
 * A joint is any position shared by **two or more** came endpoints; a lone endpoint is a run ending
 * in the frame, which carries no lump. Positions are matched on a 0.01 mm grid: the lead-line
 * network already shares exact node coordinates, and the quantisation only guards against float
 * drift through `segmentToWorldPoints`.
 *
 * Pure and derivation-shaped: computed once per scene build, never per frame (FR-6 keeps allocation
 * off the render hot path).
 */
export interface CameJoint {
  readonly at: Vec2
  /** The widest came meeting here — the blob is sized from this. */
  readonly widthMm: number
  /**
   * The kind of that widest came, so the blob is tinted like the metal it joins: a lead-came panel's
   * joints are lead-dark, only a copper-foil panel's are solder-bright.
   */
  readonly kind: CameRibbonInput['kind']
}

/** The soldered intersections of a set of came runs. */
export function cameJoints(cames: readonly CameRibbonInput[]): CameJoint[] {
  const seen = new Map<
    string,
    { at: Vec2; widthMm: number; kind: CameRibbonInput['kind']; count: number }
  >()

  for (const came of cames) {
    if (came.points.length < 2) continue
    // Only the two ends of a run can meet another run; interior vertices are just curve detail.
    for (const end of [came.points[0]!, came.points[came.points.length - 1]!]) {
      const key = `${Math.round(end.x * 100)}:${Math.round(end.y * 100)}`
      const hit = seen.get(key)
      if (hit) {
        hit.count += 1
        if (came.widthMm > hit.widthMm) {
          hit.widthMm = came.widthMm
          hit.kind = came.kind
        }
      } else {
        seen.set(key, { at: end, widthMm: came.widthMm, kind: came.kind, count: 1 })
      }
    }
  }

  const joints: CameJoint[] = []
  for (const { at, widthMm, kind, count } of seen.values()) {
    if (count >= 2) joints.push({ at, widthMm, kind })
  }
  return joints
}
