import type { InkMask } from './types'

/**
 * Zhang–Suen thinning (F-059's core requirement, FR-1).
 *
 * This is the step that makes autotrace worth having, and the reason `potrace` is the wrong library:
 * potrace traces the *outline* of an ink region, so a 2 mm pencil stroke comes back as a closed loop
 * around the stroke — two lines where the designer drew one. Thinning instead erodes each stroke to a
 * one-pixel-wide medial axis, so a stroke of any width yields exactly one centreline.
 *
 * The algorithm (Zhang & Suen 1984) repeats two sub-iterations until nothing changes. A boundary
 * pixel is deleted when: it has 2–6 ink neighbours, exactly one 0→1 transition going round its
 * 8-neighbourhood (so deleting it cannot break connectivity), and one of two alternating corner
 * conditions holds. Every deletion in a sub-iteration is decided against the *same* snapshot, which
 * is what keeps the result symmetric — and deterministic, which FR-6 needs.
 */

/** Maximum sub-iteration pairs. A 4096 px image cannot need more than half its shortest edge. */
const MAX_PASSES = 4096

export function thin(mask: InkMask): InkMask {
  const { width: w, height: h } = mask
  const data = Uint8Array.from(mask.data)
  if (w < 3 || h < 3) return { width: w, height: h, data }

  const doomed: number[] = []
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false
    for (const step of [0, 1] as const) {
      doomed.length = 0
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x
          if (data[i] !== 1) continue
          // P2..P9 clockwise from north, the paper's numbering.
          const p2 = data[i - w]!
          const p3 = data[i - w + 1]!
          const p4 = data[i + 1]!
          const p5 = data[i + w + 1]!
          const p6 = data[i + w]!
          const p7 = data[i + w - 1]!
          const p8 = data[i - 1]!
          const p9 = data[i - w - 1]!
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue
          const a =
            (p2 === 0 && p3 === 1 ? 1 : 0) +
            (p3 === 0 && p4 === 1 ? 1 : 0) +
            (p4 === 0 && p5 === 1 ? 1 : 0) +
            (p5 === 0 && p6 === 1 ? 1 : 0) +
            (p6 === 0 && p7 === 1 ? 1 : 0) +
            (p7 === 0 && p8 === 1 ? 1 : 0) +
            (p8 === 0 && p9 === 1 ? 1 : 0) +
            (p9 === 0 && p2 === 1 ? 1 : 0)
          if (a !== 1) continue
          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue
            if (p4 * p6 * p8 !== 0) continue
          } else {
            if (p2 * p4 * p8 !== 0) continue
            if (p2 * p6 * p8 !== 0) continue
          }
          doomed.push(i)
        }
      }
      if (doomed.length > 0) {
        changed = true
        for (const i of doomed) data[i] = 0
      }
    }
    if (!changed) break
  }

  return { width: w, height: h, data }
}

/** Neighbour offsets, index 0..7 clockwise from north. Odd indices are the diagonals. */
export const LINK_DX = [0, 1, 1, 1, 0, -1, -1, -1] as const
export const LINK_DY = [-1, -1, 0, 1, 1, 1, 0, -1] as const

/**
 * The **non-redundant** 8-neighbours of each ink pixel, as one bit per direction.
 *
 * A plain 8-neighbour count is not a usable junction test, and getting this wrong is the subtle way a
 * skeleton walk falls apart. Thinning leaves diagonal runs as staircases — `(0,0) (1,0) (1,1) (2,1)`
 * — and in a staircase `(1,0)` has three ink neighbours even though it is plainly a point along a
 * one-pixel-wide line: `(2,1)` is a *diagonal* neighbour that is already reachable through the
 * orthogonal pixel `(1,1)`. So every drawn diagonal would read as a chain of junctions and the whole
 * curve would shatter into short runs.
 *
 * The fix is the standard one: a diagonal neighbour only counts when neither of the two orthogonal
 * pixels bridging it is ink. Junctions then mean junctions.
 */
export function neighbourLinks(mask: InkMask): Uint8Array {
  const { width: w, height: h, data } = mask
  const links = new Uint8Array(w * h)
  const ink = (x: number, y: number): boolean =>
    x >= 0 && x < w && y >= 0 && y < h && data[y * w + x] === 1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (data[i] !== 1) continue
      let bits = 0
      for (let k = 0; k < 8; k++) {
        const dx = LINK_DX[k]!
        const dy = LINK_DY[k]!
        if (!ink(x + dx, y + dy)) continue
        // Diagonal: skip when an orthogonal step already connects the two pixels.
        if (dx !== 0 && dy !== 0 && (ink(x + dx, y) || ink(x, y + dy))) continue
        bits |= 1 << k
      }
      links[i] = bits
    }
  }
  return links
}

/** How many non-redundant neighbours each pixel has (0 for background pixels). */
export function neighbourCounts(mask: InkMask): Uint8Array {
  const links = neighbourLinks(mask)
  const deg = new Uint8Array(links.length)
  for (let i = 0; i < links.length; i++) {
    let bits = links[i]!
    let n = 0
    while (bits !== 0) {
      bits &= bits - 1
      n++
    }
    deg[i] = n
  }
  return deg
}
