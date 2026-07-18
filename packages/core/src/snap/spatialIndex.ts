import type { BBox } from '@vitrum/geometry'

/**
 * A grid-hash spatial index over item bounding boxes (F-012). Window queries return the
 * indices of items whose cells overlap the query rectangle, so snap/pick lookups cost
 * O(local) rather than O(total) — the property FR-4 needs to hold 60 fps in the
 * 5,000-segment stress scene. It is deliberately generic (it stores bboxes and integer
 * ids, nothing document-specific) so selection hit-testing (F-013) and DRC (F-030) can
 * reuse the same structure.
 *
 * Very large items — an infinite construction guide is stored as a huge finite line
 * (see `guide.ts`) — would otherwise smear across a ruinous number of cells. Any item
 * whose bbox spans more than `maxCellsPerItem` cells is held in a small "oversized" list
 * that every query always includes; guides are few, so this stays cheap while keeping the
 * grid dense for ordinary segments.
 */
const DEFAULT_MAX_CELLS_PER_ITEM = 32

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`
}

export class GridIndex {
  readonly #cell: number
  readonly #cells = new Map<string, number[]>()
  readonly #oversized: number[] = []
  /** Per-item generation stamp, so a query dedupes candidates without allocating a Set. */
  readonly #stamp: Int32Array
  #gen = 0

  private constructor(cell: number, count: number) {
    this.#cell = cell
    this.#stamp = new Int32Array(count)
  }

  /**
   * Build an index over `bboxes` (item `i` is the box at index `i`). `cellSize` defaults to
   * the median item extent — a robust choice that keeps a handful of items per cell without
   * being skewed by a few oversized boxes.
   */
  static build(
    bboxes: readonly BBox[],
    cellSize?: number,
    maxCellsPerItem = DEFAULT_MAX_CELLS_PER_ITEM,
  ): GridIndex {
    const cell = cellSize ?? chooseCellSize(bboxes)
    const index = new GridIndex(cell, bboxes.length)
    index.#populate(bboxes, maxCellsPerItem)
    return index
  }

  /** The cell size in world mm. */
  get cellSize(): number {
    return this.#cell
  }

  /** How many items are held in the always-checked oversized list. */
  get oversizedCount(): number {
    return this.#oversized.length
  }

  #populate(bboxes: readonly BBox[], maxCells: number): void {
    for (let i = 0; i < bboxes.length; i++) {
      const b = bboxes[i]!
      const c0x = Math.floor(b.min.x / this.#cell)
      const c1x = Math.floor(b.max.x / this.#cell)
      const c0y = Math.floor(b.min.y / this.#cell)
      const c1y = Math.floor(b.max.y / this.#cell)
      const span = (c1x - c0x + 1) * (c1y - c0y + 1)
      if (!Number.isFinite(span) || span > maxCells) {
        this.#oversized.push(i)
        continue
      }
      for (let cx = c0x; cx <= c1x; cx++) {
        for (let cy = c0y; cy <= c1y; cy++) {
          const key = cellKey(cx, cy)
          let bucket = this.#cells.get(key)
          if (!bucket) {
            bucket = []
            this.#cells.set(key, bucket)
          }
          bucket.push(i)
        }
      }
    }
  }

  /** The indices of items whose cells overlap `window`, plus every oversized item. */
  query(window: BBox): number[] {
    const out: number[] = []
    const gen = ++this.#gen
    for (const i of this.#oversized) {
      this.#stamp[i] = gen
      out.push(i)
    }
    const c0x = Math.floor(window.min.x / this.#cell)
    const c1x = Math.floor(window.max.x / this.#cell)
    const c0y = Math.floor(window.min.y / this.#cell)
    const c1y = Math.floor(window.max.y / this.#cell)
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        const bucket = this.#cells.get(cellKey(cx, cy))
        if (!bucket) continue
        for (const i of bucket) {
          if (this.#stamp[i] !== gen) {
            this.#stamp[i] = gen
            out.push(i)
          }
        }
      }
    }
    return out
  }
}

function chooseCellSize(bboxes: readonly BBox[]): number {
  const extents: number[] = []
  for (const b of bboxes) {
    const m = Math.max(b.max.x - b.min.x, b.max.y - b.min.y)
    if (Number.isFinite(m)) extents.push(m)
  }
  if (extents.length === 0) return 1
  extents.sort((a, b) => a - b)
  const median = extents[Math.floor(extents.length / 2)]!
  return Math.max(1, median)
}
