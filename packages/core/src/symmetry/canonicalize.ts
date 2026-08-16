import {
  IDENTITY,
  applyToPoint,
  distanceSq,
  invert,
  sub,
  type Transform2D,
  type Vec2,
} from '@vitrum/geometry'

import { radialCount, reflection, symmetryTransforms } from './transform'
import type { SymmetrySetup } from './types'

/**
 * Fold a world point into the **source** fundamental domain (F-052 Decision §1 / FR-5). Drawing
 * and editing are confined to the source sector by running every pointer through this before it
 * reaches a tool: a click anywhere on the canvas authors geometry in the source, which then
 * replicates live. A point already inside the source sector is returned unchanged, and the folded
 * point always lies in the same symmetry orbit as the original — so the user still draws "under the
 * cursor", just in the canonical sector.
 *
 * Pure and independent of the tool/snap contracts: the shell composes it in front of the F-012
 * resolver (`resolve(world) = snap(canonicalizeToSource(world))`), so no tool or `ResolvedPoint`
 * changes (Decision §1).
 */
export function canonicalizeToSource(world: Vec2, setup: SymmetrySetup | undefined): Vec2 {
  if (!setup || setup.mode === 'none') return world
  const { center, angle } = setup

  switch (setup.mode) {
    case 'mirror':
      return foldAcross(world, angle, center)
    case 'double-mirror':
      return foldAcross(foldAcross(world, angle, center), angle + Math.PI / 2, center)
    case 'radial': {
      const n = radialCount(setup)
      const wedge = (2 * Math.PI) / n
      const rel = sub(world, center)
      const r = Math.hypot(rel.x, rel.y)
      if (r === 0) return world // the center is fixed by every element
      // Reduce the rotation so the point sits in the first wedge [angle, angle + wedge).
      let theta = Math.atan2(rel.y, rel.x) - angle
      theta = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      const k = Math.floor(theta / wedge)
      let p = k === 0 ? world : rotateAbout(world, -k * wedge, center)
      if (setup.mirror) {
        // A mirrored radial group's domain is the half-wedge [angle, angle + wedge/2]; fold the
        // far half back across the axis at angle + wedge/2 (itself a group reflection axis).
        const within = theta - k * wedge
        if (within > wedge / 2) p = foldAcross(p, angle + wedge / 2, center, true)
      }
      return p
    }
    default:
      return world
  }
}

/** A world point folded into the source domain, plus which sector it was folded *from*. */
export interface SourceFold {
  /** The folded point, in the source fundamental domain — exactly {@link canonicalizeToSource}. */
  readonly point: Vec2
  /**
   * Index into {@link symmetryTransforms} of the group element that carries {@link point} back onto
   * the original world point: the sector the pointer was in. `0` is the source sector itself, so a
   * point already inside the fundamental domain reports `0`.
   */
  readonly sector: number
}

/**
 * {@link canonicalizeToSource} plus the **sector index** it folded from (F-052, fixing the
 * 2026-08-16-a snapping finding). Knowing the sector lets the shell evaluate snapping in the sector
 * the cursor is actually in — where the geometry the user sees and the angles they mean live — and
 * then fold the winning point back to source with {@link sectorFrame}'s inverse. Folding *first*
 * measured direction-sensitive snaps (angle) against a reflected point, which is what made a stroke
 * crossing the axis flip between 45° rays.
 *
 * The sector is found by asking which group element maps the folded point back onto the original —
 * the property callers depend on — rather than re-deriving each mode's inverse chain, so it is exact
 * for every mode. Identity is first, so points fixed by several elements (on an axis, at the center)
 * resolve deterministically to the lowest index; any of them folds back identically anyway.
 */
export function canonicalizeToSourceSector(
  world: Vec2,
  setup: SymmetrySetup | undefined,
): SourceFold {
  const point = canonicalizeToSource(world, setup)
  if (!setup || setup.mode === 'none') return { point, sector: 0 }
  const transforms = symmetryTransforms(setup)
  let sector = 0
  let best = Infinity
  for (let k = 0; k < transforms.length; k++) {
    const d = distanceSq(applyToPoint(transforms[k]!, point), world)
    if (d < best) {
      best = d
      sector = k
    }
  }
  return { point, sector }
}

/**
 * The frame of one sector: `toSector` places source geometry into sector `k` (it *is* the group
 * element, the same one {@link symmetryTransforms} hands the replica expansion), and `toSource` is
 * its exact inverse — the fold that turns a point picked in that sector back into the source
 * coordinate the document stores. Both are the identity for the source sector or with symmetry off.
 */
export function sectorFrame(
  setup: SymmetrySetup | undefined,
  sector: number,
): { toSector: Transform2D; toSource: Transform2D } {
  if (!setup || setup.mode === 'none' || sector === 0) {
    return { toSector: IDENTITY, toSource: IDENTITY }
  }
  const toSector = symmetryTransforms(setup)[sector] ?? IDENTITY
  return { toSector, toSource: invert(toSector) }
}

/**
 * Reflect `world` across the axis through `center` at `axisAngle` only when it lies on the far
 * side; the near side (or exactly on the axis) is returned unchanged, so the map is idempotent on
 * the source half-plane. `always` forces the reflection when the caller has already decided the
 * point is on the far side (radial-mirror case, where the side test is by wedge angle).
 */
function foldAcross(world: Vec2, axisAngle: number, center: Vec2, always = false): Vec2 {
  if (!always) {
    const rel = sub(world, center)
    // Signed side relative to the axis direction; ≥ 0 is the source half-plane.
    const side = Math.cos(axisAngle) * rel.y - Math.sin(axisAngle) * rel.x
    if (side >= 0) return world
  }
  return applyToPoint(reflection(axisAngle, center), world)
}

function rotateAbout(world: Vec2, delta: number, center: Vec2): Vec2 {
  const rel = sub(world, center)
  const cos = Math.cos(delta)
  const sin = Math.sin(delta)
  return {
    x: center.x + rel.x * cos - rel.y * sin,
    y: center.y + rel.x * sin + rel.y * cos,
  }
}
