import type { GreyBitmap, InkMask } from './types'

/**
 * Preprocessing: greyscale → **adaptive** binarisation → despeckle (F-059).
 *
 * Two thresholds work together, and the split matters:
 *
 * - a **local** one (darker than the surrounding mean by `bias`) removes the exposure gradient a
 *   photo or flatbed scan of a large sheet always has;
 * - an **absolute** one (`thresholdLuma`) does the semantic work. On a real cartoon the bold marker
 *   is near-black and the pencil piece numbers and colour notes are mid-grey, so the absolute cut is
 *   what keeps annotations out of the geometry (FR-8). A local rule on its own cannot: a pencil "10"
 *   is perfectly dark relative to the paper around it.
 *
 * Despeckling then removes what luminance leaves behind — the few darkest pixels of a pressed-hard
 * pencil stroke, dust, a fly speck — and *only* that. It is a cleanup pass, never the separator: a
 * hand-written "10" is about as large as a short lead segment, so sizing it out would take real
 * geometry with it.
 */

/** Row-wise integral image (summed-area table) with a zero-padded first row and column. */
function integralImage(image: GreyBitmap): Float64Array {
  const { width: w, height: h, data } = image
  const sum = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += data[y * w + x]!
      sum[(y + 1) * (w + 1) + (x + 1)] = sum[y * (w + 1) + (x + 1)]! + rowSum
    }
  }
  return sum
}

/**
 * Binarise `image`: ink where the pixel is at or below `thresholdLuma` **and** at least `bias`
 * darker than the mean of the `(2r+1)²` window around it (Bradley–Roth adaptive thresholding, O(n)
 * through the integral image).
 */
export function binarise(
  image: GreyBitmap,
  thresholdLuma: number,
  radiusPx: number,
  bias: number,
): InkMask {
  const { width: w, height: h, data } = image
  const out = new Uint8Array(w * h)
  if (w === 0 || h === 0) return { width: w, height: h, data: out }
  const r = Math.max(1, Math.round(radiusPx))
  const sum = integralImage(image)
  const stride = w + 1

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const value = data[y * w + x]!
      if (value > thresholdLuma) continue
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const total =
        sum[y1 * stride + x1]! -
        sum[y0 * stride + x1]! -
        sum[y1 * stride + x0]! +
        sum[y0 * stride + x0]!
      const mean = total / ((y1 - y0) * (x1 - x0))
      if (value <= mean - bias) out[y * w + x] = 1
    }
  }
  return { width: w, height: h, data: out }
}

export interface DespeckleResult {
  readonly mask: InkMask
  /** How many connected blobs were removed. */
  readonly removed: number
  /** Ink pixels remaining. */
  readonly inkPx: number
}

/**
 * Drop 8-connected ink blobs smaller than `minAreaPx`. Iterative flood fill over a typed stack, so a
 * full-sheet network cannot blow the call stack.
 */
export function despeckle(mask: InkMask, minAreaPx: number): DespeckleResult {
  const { width: w, height: h, data } = mask
  const out = new Uint8Array(w * h)
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  const blob = new Int32Array(w * h)
  let removed = 0
  let inkPx = 0

  for (let start = 0; start < data.length; start++) {
    if (data[start] !== 1 || seen[start] === 1) continue
    let top = 0
    let count = 0
    stack[top++] = start
    seen[start] = 1
    while (top > 0) {
      const i = stack[--top]!
      blob[count++] = i
      const x = i % w
      const y = (i - x) / w
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const j = ny * w + nx
          if (data[j] === 1 && seen[j] === 0) {
            seen[j] = 1
            stack[top++] = j
          }
        }
      }
    }
    if (count >= minAreaPx) {
      for (let k = 0; k < count; k++) out[blob[k]!] = 1
      inkPx += count
    } else {
      removed++
    }
  }

  return { mask: { width: w, height: h, data: out }, removed, inkPx }
}

/**
 * Fill background blobs of at most `maxAreaPx` that are fully enclosed by ink.
 *
 * A drawn stroke is solid on paper, but thresholding leaves pinholes in it wherever the marker ran
 * thin. Thinning turns every pinhole into a **ladder** — the centreline splits into two strands around
 * the hole and rejoins — and each rung becomes a sliver piece two or three pixels across. On the
 * reference cartoon that was five spurious regions out of eleven, which is the difference between a
 * believable piece count and a useless one. So the holes go before the skeleton is built.
 *
 * Blobs touching the image edge are left alone: they are the paper around the drawing, not holes.
 */
export function fillHoles(mask: InkMask, maxAreaPx: number): InkMask {
  const { width: w, height: h, data } = mask
  const out = Uint8Array.from(data)
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  const blob = new Int32Array(w * h)

  for (let start = 0; start < data.length; start++) {
    if (data[start] !== 0 || seen[start] === 1) continue
    let top = 0
    let count = 0
    let touchesEdge = false
    stack[top++] = start
    seen[start] = 1
    while (top > 0) {
      const i = stack[--top]!
      blob[count++] = i
      const x = i % w
      const y = (i - x) / w
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true
      // 4-connected: a diagonal chink of ink should still count as sealing the hole.
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ]
      for (const j of neighbours) {
        if (j < 0) continue
        if (data[j] === 0 && seen[j] === 0) {
          seen[j] = 1
          stack[top++] = j
        }
      }
    }
    if (!touchesEdge && count <= maxAreaPx) {
      for (let k = 0; k < count; k++) out[blob[k]!] = 1
    }
  }
  return { width: w, height: h, data: out }
}

/** Convert an RGBA buffer (as `ImageData.data`) to greyscale using the Rec. 601 luma weights. */
export function rgbaToGrey(rgba: ArrayLike<number>, width: number, height: number): GreyBitmap {
  const data = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++) {
    const o = i * 4
    const r = rgba[o]!
    const g = rgba[o + 1]!
    const b = rgba[o + 2]!
    const a = rgba[o + 3]!
    const luma = 0.299 * r + 0.587 * g + 0.114 * b
    // Composite over white: a transparent scan background must read as paper, not as ink.
    const alpha = a / 255
    data[i] = Math.round(luma * alpha + 255 * (1 - alpha))
  }
  return { width, height, data }
}
