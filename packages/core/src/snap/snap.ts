import type { BBox, Curve, Vec2 } from '@vitrum/geometry'
import {
  add,
  arcEnd,
  arcStart,
  bboxOf,
  closestPoint,
  distance,
  distanceSq,
  dot,
  intersect,
  pointAt,
  scale,
  sub,
  vec2,
} from '@vitrum/geometry'

import { GridIndex } from './spatialIndex'
import type { SnapHit, SnapSettings } from './types'

/**
 * The snap engine (F-012). Pure and DOM-free: given a scene of candidate curves indexed in
 * a {@link GridIndex} and a query (cursor position, radius, grid, gesture anchors), it
 * returns the highest-priority snap within the radius, or `null`. The UI wraps this in the
 * F-011 pointer-resolver hook so every tool consumes snapped world points with no tool
 * change.
 */

/** One thing snapping can attach to: a document curve (lead, border or construction guide). */
export interface SnapTarget {
  readonly geometry: Curve
}

/** Targets plus the spatial index built over their bounding boxes. */
export interface SnapScene {
  readonly targets: readonly SnapTarget[]
  readonly index: GridIndex
}

/** Build a snap scene: index every target's bbox for O(local) queries. */
export function buildSnapScene(targets: readonly SnapTarget[], cellSize?: number): SnapScene {
  const index = GridIndex.build(
    targets.map((t) => bboxOf(t.geometry)),
    cellSize,
  )
  return { targets, index }
}

export interface SnapQuery {
  /** The raw cursor position in world mm (before snapping). */
  readonly world: Vec2
  /** Snap radius in world mm — the UI converts the screen-px radius by the viewport scale. */
  readonly radiusMm: number
  /** Grid spacing in world mm for grid snap, or `null` to skip grid snap. */
  readonly gridMm: number | null
  /**
   * The gesture's own placed points (F-011 `ToolDef.anchors`). Used for snap-to-self
   * (endpoints) and for angle/extension snapping relative to the last placed point.
   */
  readonly anchors: readonly Vec2[]
  /**
   * The ray the span is locked to, when an angular constraint is active (Shift). On-curve
   * snapping then reports where the ray **crosses** a curve instead of the nearest point on it,
   * so the constrained angle and the snap can both hold — without this, whichever is applied
   * last wins and the other is silently discarded.
   */
  readonly ray?: { readonly origin: Vec2; readonly dir: Vec2 } | undefined
  readonly settings: SnapSettings
}

const ANGLE_STEP = Math.PI / 4 // 0 / 45 / 90 … construction angles

/**
 * Resolve the winning snap for `query` against `scene`, or `null` for none. Walks the snap
 * kinds in priority order (endpoint → intersection → midpoint → on-curve → grid → angle);
 * the first kind with a candidate inside the radius wins, nearest-within-kind (FR-2).
 */
export function resolveSnap(scene: SnapScene, query: SnapQuery): SnapHit | null {
  if (!query.settings.master) return null

  const { world, radiusMm } = query
  const r2 = radiusMm * radiusMm
  const window: BBox = {
    min: vec2(world.x - radiusMm, world.y - radiusMm),
    max: vec2(world.x + radiusMm, world.y + radiusMm),
  }
  const candidates = scene.index.query(window).map((i) => scene.targets[i]!.geometry)
  const { toggles } = query.settings

  if (toggles.endpoint) {
    const hit = nearestEndpoint(candidates, query.anchors, world, r2)
    if (hit) return hit
  }
  if (toggles.intersection) {
    const hit = nearestIntersection(candidates, world, r2)
    if (hit) return hit
  }
  if (toggles.midpoint) {
    const hit = nearestMidpoint(candidates, world, r2)
    if (hit) return hit
  }
  if (toggles['on-curve']) {
    const hit = query.ray
      ? nearestCrossingAlongRay(candidates, world, query.ray, radiusMm)
      : nearestOnCurve(candidates, world, r2)
    if (hit) return hit
  }
  if (toggles.grid && query.gridMm) {
    const hit = snapGrid(world, query.gridMm, r2)
    if (hit) return hit
  }
  if (toggles.angle) {
    const hit = snapAngle(query.anchors, world, radiusMm)
    if (hit) return hit
  }
  return null
}

/** The two endpoints of a curve, as their exact stored coordinates (bit-identity, FR-1). */
export function curveEndpoints(c: Curve): readonly [Vec2, Vec2] {
  switch (c.kind) {
    case 'line':
      return [c.a, c.b]
    case 'cubic':
      return [c.p0, c.p3]
    case 'arc':
      return [arcStart(c), arcEnd(c)]
    case 'polyline':
      return [c.points[0]!, c.points[c.points.length - 1]!]
  }
}

function nearestEndpoint(
  candidates: readonly Curve[],
  anchors: readonly Vec2[],
  world: Vec2,
  r2: number,
): SnapHit | null {
  let best: Vec2 | null = null
  let bestD = Infinity
  const consider = (p: Vec2): void => {
    const d = distanceSq(p, world)
    if (d <= r2 && d < bestD) {
      bestD = d
      best = p
    }
  }
  // Gesture self-anchors first (so closing a shape welds to its own start).
  for (const a of anchors) consider(a)
  for (const c of candidates) {
    const [s, e] = curveEndpoints(c)
    consider(s)
    consider(e)
  }
  // Return the exact stored coordinate — no recomputation — so the weld is bit-identical.
  return best ? { kind: 'endpoint', world: best } : null
}

function nearestIntersection(
  candidates: readonly Curve[],
  world: Vec2,
  r2: number,
): SnapHit | null {
  let best: Vec2 | null = null
  let bestD = Infinity
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      for (const x of intersect(candidates[i]!, candidates[j]!)) {
        const d = distanceSq(x.point, world)
        if (d <= r2 && d < bestD) {
          bestD = d
          best = x.point
        }
      }
    }
  }
  return best ? { kind: 'intersection', world: best } : null
}

function nearestMidpoint(candidates: readonly Curve[], world: Vec2, r2: number): SnapHit | null {
  let best: Vec2 | null = null
  let bestD = Infinity
  for (const c of candidates) {
    const mid = pointAt(c, 0.5)
    const d = distanceSq(mid, world)
    if (d <= r2 && d < bestD) {
      bestD = d
      best = mid
    }
  }
  return best ? { kind: 'midpoint', world: best } : null
}

function nearestOnCurve(candidates: readonly Curve[], world: Vec2, r2: number): SnapHit | null {
  let best: Vec2 | null = null
  let bestD = Infinity
  for (const c of candidates) {
    const cp = closestPoint(c, world)
    const d = cp.distance * cp.distance
    if (d <= r2 && d < bestD) {
      bestD = d
      best = cp.point
    }
  }
  return best ? { kind: 'on-curve', world: best } : null
}

/**
 * On-curve snapping along a constrained ray: where does the ray the span is locked to actually
 * cross a nearby curve? The crossing nearest the cursor within the radius wins, so a Shift-locked
 * line ending on the border frame lands exactly on the frame *and* keeps its exact angle — the
 * perpendicular projection {@link nearestOnCurve} returns would be off the ray, and the tool's
 * angular constraint would then rotate it straight back off the curve.
 *
 * The ray is probed as a finite line from its origin to a little past the cursor, so the crossing
 * we care about is covered without relying on huge coordinates.
 */
function nearestCrossingAlongRay(
  candidates: readonly Curve[],
  world: Vec2,
  ray: { origin: Vec2; dir: Vec2 },
  radiusMm: number,
): SnapHit | null {
  const reach = distance(ray.origin, world) + radiusMm
  if (reach <= 0) return null
  const probe: Curve = {
    kind: 'line',
    a: ray.origin,
    b: add(ray.origin, scale(ray.dir, reach)),
  }
  let best: Vec2 | null = null
  let bestD = Infinity
  for (const c of candidates) {
    for (const x of intersect(probe, c)) {
      const d = distance(x.point, world)
      if (d <= radiusMm && d < bestD) {
        bestD = d
        best = x.point
      }
    }
  }
  return best ? { kind: 'on-curve', world: best } : null
}

function snapGrid(world: Vec2, gridMm: number, r2: number): SnapHit | null {
  const node = vec2(Math.round(world.x / gridMm) * gridMm, Math.round(world.y / gridMm) * gridMm)
  return distanceSq(node, world) <= r2 ? { kind: 'grid', world: node } : null
}

/**
 * Angle / extension snapping relative to the gesture's placed points. From the most recent
 * anchor, snap the cursor onto the nearest ray at a multiple of 45°; from every anchor,
 * snap onto its horizontal and vertical extension lines. The winner is the line whose
 * perpendicular distance to the cursor is smallest and within the radius. A guide segment
 * from the reference anchor to the snapped point is returned for the overlay.
 */
function snapAngle(anchors: readonly Vec2[], world: Vec2, radiusMm: number): SnapHit | null {
  if (anchors.length === 0) return null
  const ref = anchors[anchors.length - 1]!
  let best: { point: Vec2; base: Vec2 } | null = null
  let bestPerp = Infinity

  const consider = (base: Vec2, dir: Vec2): void => {
    const w = sub(world, base)
    const proj = dot(w, dir)
    const point = add(base, scale(dir, proj))
    const perp = distance(point, world)
    if (perp <= radiusMm && perp < bestPerp) {
      bestPerp = perp
      best = { point, base }
    }
  }

  for (let k = 0; k < 8; k++) {
    const a = k * ANGLE_STEP
    consider(ref, vec2(Math.cos(a), Math.sin(a)))
  }
  for (const anchor of anchors) {
    consider(anchor, vec2(1, 0))
    consider(anchor, vec2(0, 1))
  }

  if (!best) return null
  const hit = best as { point: Vec2; base: Vec2 }
  return { kind: 'angle', world: hit.point, guides: [[hit.base, hit.point]] }
}
