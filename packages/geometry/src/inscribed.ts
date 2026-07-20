import { bboxOfPoints } from './bbox'
import { pointInPolygon, signedArea } from './polygon'
import { polygon } from './types'
import type { Vec2 } from './vec2'

/**
 * The largest circle that fits inside a polygon (the "pole of inaccessibility"), and where its
 * centre sits. This is a stable proxy for a piece's **inscribed width** — twice the radius is the
 * widest span of glass the piece contains — which DRC cuttability (F-031) reads to flag slivers:
 * a piece thin enough that even its fattest point is narrower than a cutter can safely handle.
 *
 * The algorithm is Mapbox's `polylabel` (a quadtree search that always refines the cell with the
 * greatest *potential* distance and stops once no cell can beat the best by more than `precision`).
 * It is deterministic and bounded — no rasterisation, no random seeding — which is exactly the
 * "exactness isn't needed, stability is" the spec asks for. Failure mode: on a shape with a long
 * uniform neck the reported centre may sit anywhere along the neck, but its radius (the quantity the
 * sliver rule uses) is stable to `precision`.
 */
export interface InscribedCircle {
  readonly center: Vec2
  readonly radius: number
}

interface Cell {
  readonly x: number
  readonly y: number
  /** Half the cell's side. */
  readonly h: number
  /** Signed distance from the cell centre to the polygon (positive inside). */
  readonly d: number
  /** The most this cell (or any child) could possibly score. */
  readonly max: number
}

const SQRT2 = Math.SQRT2

/**
 * Compute the inscribed circle of a polygon given as an outer ring and optional hole rings (mm).
 * `precision` bounds the radius error in mm (default 0.1 mm — well under any cuttability threshold).
 * A degenerate ring (fewer than 3 vertices or zero extent) yields a zero-radius circle at its
 * centroid.
 */
export function inscribedCircle(
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[] = [],
  precision = 0.1,
): InscribedCircle {
  if (outer.length < 3) return { center: centroidOf(outer), radius: 0 }

  const bbox = bboxOfPoints(outer)
  const width = bbox.max.x - bbox.min.x
  const height = bbox.max.y - bbox.min.y
  const cellSize = Math.min(width, height)
  if (cellSize <= 0) return { center: centroidOf(outer), radius: 0 }

  const poly = polygon(outer, holes)
  const h = cellSize / 2
  const dist = (x: number, y: number): number => signedDistance(poly, x, y)

  // A max-heap of cells keyed by their potential `max`, so we always refine the most promising cell.
  const heap = new Heap()
  for (let x = bbox.min.x; x < bbox.max.x; x += cellSize) {
    for (let y = bbox.min.y; y < bbox.max.y; y += cellSize) {
      heap.push(makeCell(x + h, y + h, h, dist))
    }
  }

  // Seed the best with the cell at the bbox centre and the polygon centroid — either can beat a
  // naive grid on a lopsided shape.
  let best = makeCell(bbox.min.x + width / 2, bbox.min.y + height / 2, 0, dist)
  const centroidCell = centroidCellOf(poly, dist)
  if (centroidCell.d > best.d) best = centroidCell

  while (heap.size > 0) {
    const cell = heap.pop()!
    if (cell.d > best.d) best = cell
    // No child of this cell can beat the best by more than the precision — prune it.
    if (cell.max - best.d <= precision) continue
    const q = cell.h / 2
    heap.push(makeCell(cell.x - q, cell.y - q, q, dist))
    heap.push(makeCell(cell.x + q, cell.y - q, q, dist))
    heap.push(makeCell(cell.x - q, cell.y + q, q, dist))
    heap.push(makeCell(cell.x + q, cell.y + q, q, dist))
  }

  return { center: { x: best.x, y: best.y }, radius: Math.max(0, best.d) }
}

function makeCell(x: number, y: number, h: number, dist: (x: number, y: number) => number): Cell {
  const d = dist(x, y)
  return { x, y, h, d, max: d + h * SQRT2 }
}

function centroidCellOf(
  poly: ReturnType<typeof polygon>,
  dist: (x: number, y: number) => number,
): Cell {
  const c = centroidOf(poly.outer)
  return makeCell(c.x, c.y, 0, dist)
}

/** Signed distance from a point to a polygon: distance to the nearest edge, negative outside. */
function signedDistance(poly: ReturnType<typeof polygon>, x: number, y: number): number {
  let min = Infinity
  min = Math.min(min, ringDistanceSq(poly.outer, x, y))
  for (const hole of poly.holes) min = Math.min(min, ringDistanceSq(hole, x, y))
  const d = Math.sqrt(min)
  return pointInPolygon(poly, { x, y }) ? d : -d
}

/** Squared distance from a point to the nearest edge of a ring. */
function ringDistanceSq(ring: readonly Vec2[], px: number, py: number): number {
  let min = Infinity
  const n = ring.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    min = Math.min(min, segmentDistanceSq(px, py, a.x, a.y, b.x, b.y))
  }
  return min
}

function segmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  let dx = bx - ax
  let dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  dx = px - (ax + t * dx)
  dy = py - (ay + t * dy)
  return dx * dx + dy * dy
}

function centroidOf(ring: readonly Vec2[]): Vec2 {
  if (ring.length === 0) return { x: 0, y: 0 }
  // Area-weighted centroid, falling back to the vertex average for a degenerate ring.
  const a2 = signedArea(ring) * 2
  if (Math.abs(a2) < 1e-12) {
    let x = 0
    let y = 0
    for (const p of ring) {
      x += p.x
      y += p.y
    }
    return { x: x / ring.length, y: y / ring.length }
  }
  let cx = 0
  let cy = 0
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const p = ring[i]!
    const q = ring[(i + 1) % n]!
    const cross = p.x * q.y - q.x * p.y
    cx += (p.x + q.x) * cross
    cy += (p.y + q.y) * cross
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) }
}

/** A tiny binary max-heap of cells keyed by `max`, so `pop` yields the most promising cell. */
class Heap {
  #items: Cell[] = []

  get size(): number {
    return this.#items.length
  }

  push(cell: Cell): void {
    const items = this.#items
    items.push(cell)
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent]!.max >= items[i]!.max) break
      ;[items[parent], items[i]] = [items[i]!, items[parent]!]
      i = parent
    }
  }

  pop(): Cell | undefined {
    const items = this.#items
    const top = items[0]
    const last = items.pop()
    if (items.length > 0 && last !== undefined) {
      items[0] = last
      let i = 0
      const n = items.length
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let largest = i
        if (l < n && items[l]!.max > items[largest]!.max) largest = l
        if (r < n && items[r]!.max > items[largest]!.max) largest = r
        if (largest === i) break
        ;[items[largest], items[i]] = [items[i]!, items[largest]!]
        i = largest
      }
    }
    return top
  }
}
