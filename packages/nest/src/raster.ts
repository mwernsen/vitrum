import type { Vec2 } from '@vitrum/geometry'

/**
 * Bitmap collision core for the nester. A piece is rasterised to a bit-packed occupancy mask; a sheet
 * is one big mask; placement is a bottom-left scan testing the piece mask against the sheet mask with
 * cheap word-wise AND. Rasterising (rather than doing analytic no-fit-polygon maths) is what lets the
 * nester interlock concave pieces and pieces with holes for free — the property that makes it beat
 * naive bounding-box packing (FR-2) — and it is far simpler to get provably correct.
 */

/** A bit-packed boolean grid. Bit (c, r) lives at `words[r * wordsPerRow + (c >>> 5)] >> (c & 31)`. */
export interface Mask {
  readonly cols: number
  readonly rows: number
  readonly wordsPerRow: number
  readonly words: Uint32Array
}

function makeMask(cols: number, rows: number, guardWords = 0): Mask {
  const wordsPerRow = Math.ceil(cols / 32) + guardWords
  return { cols, rows, wordsPerRow, words: new Uint32Array(wordsPerRow * Math.max(rows, 0)) }
}

function setBit(m: Mask, c: number, r: number): void {
  const idx = r * m.wordsPerRow + (c >>> 5)
  m.words[idx] = (m.words[idx] ?? 0) | (1 << (c & 31))
}

/** True iff cell (c, r) is set. Out-of-range reads as unset. */
export function getBit(m: Mask, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= m.cols || r >= m.rows) return false
  return ((m.words[r * m.wordsPerRow + (c >>> 5)] ?? 0) & (1 << (c & 31))) !== 0
}

/** Count of set cells (for area/utilisation sanity checks and tests). */
export function popcount(m: Mask): number {
  let n = 0
  for (let i = 0; i < m.words.length; i++) {
    let w = m.words[i]
    while (w) {
      w &= w - 1
      n++
    }
  }
  return n
}

/**
 * Rasterise a set of rings (outer + holes, mm) into a tight mask at resolution `res`, using the
 * even-odd rule over all edges together — so holes (and nested islands) fall out automatically
 * regardless of winding. A cell is filled when its centre is inside. `originX/Y` is the mm coordinate
 * of cell (0, 0)'s corner.
 */
export function rasterizeRings(
  rings: readonly (readonly Vec2[])[],
  res: number,
  originX: number,
  originY: number,
  cols: number,
  rows: number,
): Mask {
  const m = makeMask(cols, rows)
  const xs: number[] = []
  for (let r = 0; r < rows; r++) {
    const y = originY + (r + 0.5) * res
    xs.length = 0
    for (const ring of rings) {
      const n = ring.length
      for (let i = 0; i < n; i++) {
        const a = ring[i]!
        const b = ring[(i + 1) % n]!
        const ay = a.y
        const by = b.y
        // Half-open crossing test avoids double-counting shared vertices.
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          const t = (y - ay) / (by - ay)
          xs.push(a.x + t * (b.x - a.x))
        }
      }
    }
    if (xs.length < 2) continue
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = xs[k]!
      const x1 = xs[k + 1]!
      // Cells whose centre lies in [x0, x1].
      let c0 = Math.ceil((x0 - originX) / res - 0.5)
      let c1 = Math.floor((x1 - originX) / res - 0.5)
      if (c0 < 0) c0 = 0
      if (c1 > cols - 1) c1 = cols - 1
      for (let c = c0; c <= c1; c++) setBit(m, c, r)
    }
  }
  return m
}

/**
 * Grow a mask by `d` cells (Euclidean disk) into a new mask padded by `d` on every side — the
 * per-piece cut allowance. Two placed dilated masks that don't overlap keep their source pieces at
 * least ~`2·d·res` mm apart, and staying inside the sheet grid keeps a `d`-cell margin from the edge.
 * `d = 0` returns an unpadded copy.
 */
export function dilate(src: Mask, d: number): Mask {
  if (d <= 0) return { ...src, words: src.words.slice() }
  const out = makeMask(src.cols + 2 * d, src.rows + 2 * d)
  const disk: Array<[number, number]> = []
  for (let dy = -d; dy <= d; dy++)
    for (let dx = -d; dx <= d; dx++) if (dx * dx + dy * dy <= d * d) disk.push([dx, dy])
  for (let r = 0; r < src.rows; r++) {
    for (let c = 0; c < src.cols; c++) {
      if (!getBit(src, c, r)) continue
      const bc = c + d
      const br = r + d
      for (const [dx, dy] of disk) setBit(out, bc + dx, br + dy)
    }
  }
  return out
}

/** A sheet's occupancy grid (mutable), with a one-word row guard so shifted stamps never overflow. */
export function makeSheet(cols: number, rows: number): Mask {
  return makeMask(cols, rows, 1)
}

/**
 * True iff placing `mask` with its cell (0,0) at sheet cell (ox, oy) would overlap already-placed
 * pieces. Assumes the placement fits the sheet bounds (checked by the caller). Word-wise AND with the
 * piece mask shifted left by `ox` bits.
 */
export function collides(sheet: Mask, mask: Mask, ox: number, oy: number): boolean {
  const shift = ox & 31
  const wordOffset = ox >>> 5
  const spw = sheet.wordsPerRow
  const mpw = mask.wordsPerRow
  for (let r = 0; r < mask.rows; r++) {
    const sBase = (oy + r) * spw + wordOffset
    const mBase = r * mpw
    for (let mw = 0; mw < mpw; mw++) {
      const bits = mask.words[mBase + mw] ?? 0
      if (bits === 0) continue
      const lo = (bits << shift) >>> 0
      if (((sheet.words[sBase + mw] ?? 0) & lo) !== 0) return true
      if (shift !== 0) {
        const hi = bits >>> (32 - shift)
        if (hi !== 0 && ((sheet.words[sBase + mw + 1] ?? 0) & hi) !== 0) return true
      }
    }
  }
  return false
}

/** OR `mask` into the sheet at (ox, oy). Same shift arithmetic as {@link collides}. */
export function stamp(sheet: Mask, mask: Mask, ox: number, oy: number): void {
  const shift = ox & 31
  const wordOffset = ox >>> 5
  const spw = sheet.wordsPerRow
  const mpw = mask.wordsPerRow
  for (let r = 0; r < mask.rows; r++) {
    const sBase = (oy + r) * spw + wordOffset
    const mBase = r * mpw
    for (let mw = 0; mw < mpw; mw++) {
      const bits = mask.words[mBase + mw] ?? 0
      if (bits === 0) continue
      const lowIdx = sBase + mw
      sheet.words[lowIdx] = (sheet.words[lowIdx] ?? 0) | ((bits << shift) >>> 0)
      if (shift !== 0) {
        const hi = bits >>> (32 - shift)
        if (hi !== 0) {
          const hiIdx = sBase + mw + 1
          sheet.words[hiIdx] = (sheet.words[hiIdx] ?? 0) | hi
        }
      }
    }
  }
}
