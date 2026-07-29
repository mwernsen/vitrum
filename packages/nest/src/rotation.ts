import type { NestRotationPolicy } from './types'

/**
 * The discrete rotation angles (degrees) a piece may take under each policy. `fixed` pins pieces
 * upright; `flip` adds a 180° turn (grain-safe for streaky glass); `quadrant` and `free` are for
 * isotropic glass where grain doesn't matter. The raster nester tries each angle and keeps the best
 * placement, so a finer set trades a little speed for tighter nesting.
 */
export function rotationsFor(policy: NestRotationPolicy): readonly number[] {
  switch (policy) {
    case 'fixed':
      return [0]
    case 'flip':
      return [0, 180]
    case 'quadrant':
      return [0, 90, 180, 270]
    case 'free':
      return [0, 45, 90, 135, 180, 225, 270, 315]
  }
}
