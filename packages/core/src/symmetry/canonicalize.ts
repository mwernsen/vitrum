import { applyToPoint, sub, type Vec2 } from '@vitrum/geometry'

import { radialCount, reflection } from './transform'
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
