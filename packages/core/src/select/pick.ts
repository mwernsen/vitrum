import type { BBox, Curve, Vec2 } from '@vitrum/geometry'
import { bboxOf, closestPoint, distance, vec2 } from '@vitrum/geometry'

import { GridIndex } from '../snap/spatialIndex'

/**
 * Selection hit-testing (F-013 FR-2). Pure and framework-free: it reuses the F-012
 * {@link GridIndex} so a pick over a 5,000-segment scene stays O(local), and it measures the
 * true distance to each candidate **curve** (via the kernel's `closestPoint`) — not its
 * bounding box — so clicking near a curve's bbox but far from the curve does not select it.
 * The tolerance is a world-mm radius; the UI converts a fixed screen-px radius by the viewport
 * scale so picking is zoom-independent.
 */

/** One pickable thing: a segment id and its geometry. */
export interface PickTarget {
  readonly id: string
  readonly geometry: Curve
}

/** Targets plus the spatial index built over their bounding boxes. */
export interface PickScene {
  readonly targets: readonly PickTarget[]
  readonly index: GridIndex
}

/** A pick result: which target, the true curve distance, and the on-curve parameter. */
export interface PickHit {
  readonly id: string
  readonly distance: number
  readonly t: number
}

/** Build a pick scene: index every target's bbox for O(local) window queries. */
export function buildPickScene(targets: readonly PickTarget[], cellSize?: number): PickScene {
  const index = GridIndex.build(
    targets.map((t) => bboxOf(t.geometry)),
    cellSize,
  )
  return { targets, index }
}

/**
 * Every target within `tolMm` of `world`, **nearest curve first**. The grid narrows the
 * candidate set to the query window (radius `tolMm`); each candidate is then measured against
 * its actual curve. Ties keep the index order (stable), so repeated clicks cycle deterministically.
 */
export function pickSegments(scene: PickScene, world: Vec2, tolMm: number): PickHit[] {
  const window: BBox = {
    min: vec2(world.x - tolMm, world.y - tolMm),
    max: vec2(world.x + tolMm, world.y + tolMm),
  }
  const hits: PickHit[] = []
  for (const i of scene.index.query(window)) {
    const target = scene.targets[i]
    if (!target) continue
    const cp = closestPoint(target.geometry, world)
    if (cp.distance <= tolMm) hits.push({ id: target.id, distance: cp.distance, t: cp.t })
  }
  hits.sort((a, b) => a.distance - b.distance)
  return hits
}

/** The single nearest target within `tolMm`, or `null`. */
export function pickSegment(scene: PickScene, world: Vec2, tolMm: number): PickHit | null {
  return pickSegments(scene, world, tolMm)[0] ?? null
}

/** A node candidate for point-picking (dragging junctions). */
export interface NodeTarget {
  readonly id: string
  readonly pos: Vec2
}

/** The nearest node within `tolMm` of `world`, or `null`. Nodes take priority over segments. */
export function pickNode(
  nodes: readonly NodeTarget[],
  world: Vec2,
  tolMm: number,
): NodeTarget | null {
  let best: NodeTarget | null = null
  let bestD = tolMm
  for (const node of nodes) {
    const d = distance(node.pos, world)
    if (d <= bestD) {
      bestD = d
      best = node
    }
  }
  return best
}
