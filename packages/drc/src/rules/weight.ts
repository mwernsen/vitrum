import { pieceKey, resolveCame } from '@vitrum/core'
import { curveLength } from '@vitrum/geometry'

import type { DrcInput } from '../types'

/**
 * Panel-weight estimation (F-032). Pure arithmetic over the document + derived data, split out so
 * the `panel-weight` rule and its unit test share one model (FR-3: accurate within 10 % of a
 * hand-computed reference). Two contributions:
 *
 * - **Glass** — the dominant term, and computed exactly: for each detected piece,
 *   `area(mm²) × thickness(mm) × ρ_glass`. Thickness comes from the piece's *effective* glass
 *   (F-023, direct or inherited), falling back to the catalog default (3 mm) for an unassigned
 *   piece. Soda-lime glass is ≈ 2.5 g/cm³.
 * - **Lead / solder** — an estimate, per the spec. For lead came we model each output line's came
 *   as a solid bar of cross-section `flange × heart` (a deliberately coarse H-profile proxy — the
 *   two flanges plus the heart web roughly fill that rectangle) at lead's 11.34 g/cm³, times the
 *   line's true length. For copper foil we use a flat solder+foil linear mass per length. Both are
 *   documented approximations; glass dominates, so the total stays within the FR-3 band.
 */

/** Densities in grams per cubic millimetre (1 g/cm³ = 1e-3 g/mm³). */
const GLASS_DENSITY_G_PER_MM3 = 2.5e-3
const LEAD_DENSITY_G_PER_MM3 = 11.34e-3

/** Default glass thickness (mm) for a piece with no effective glass — the catalog default. */
const DEFAULT_THICKNESS_MM = 3

/**
 * Foil + solder linear mass (g/mm). A foiled joint carries a thin copper wrap and a solder bead;
 * ≈ 40 g/m is a representative bead, i.e. 0.04 g/mm. Coarse, but foil work is light and glass
 * dominates the total.
 */
const FOIL_SOLDER_G_PER_MM = 0.04

export interface PanelWeight {
  /** Total estimated weight in grams. */
  readonly grams: number
  readonly glassGrams: number
  readonly leadGrams: number
}

/** Estimate the assembled panel weight (F-032). See the module doc for the model. */
export function panelWeight(input: DrcInput): PanelWeight {
  const glassGrams = glassWeight(input)
  const leadGrams = leadWeight(input)
  return { grams: glassGrams + leadGrams, glassGrams, leadGrams }
}

function glassWeight(input: DrcInput): number {
  const effective = input.effectiveGlass ?? {}
  let grams = 0
  for (const piece of input.pieces) {
    const glassId = effective[pieceKey(piece)]
    const thickness =
      (glassId && input.project.glasses[glassId]?.thicknessMm) || DEFAULT_THICKNESS_MM
    grams += piece.area * thickness * GLASS_DENSITY_G_PER_MM3
  }
  return grams
}

function leadWeight(input: DrcInput): number {
  const technique = input.project.technique
  let grams = 0
  for (const segment of Object.values(input.project.segments)) {
    if (segment.role === 'construction') continue
    const length = curveLength(segment.geometry)
    if (technique.kind === 'foil') {
      grams += length * FOIL_SOLDER_G_PER_MM
    } else {
      const came = resolveCame(technique, segment.id)
      const crossSectionMm2 = came.flangeMm * came.heartMm
      grams += length * crossSectionMm2 * LEAD_DENSITY_G_PER_MM3
    }
  }
  return grams
}
