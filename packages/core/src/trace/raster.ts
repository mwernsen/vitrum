import { applyHomography, bboxOfPoints, type Mat3, type Quad, type Vec2 } from '@vitrum/geometry'

import type { GreyBitmap, TraceGrid } from './types'

/**
 * Resampling an F-051 reference layer into a world-aligned pixel grid (F-059).
 *
 * The UI decodes the layer's image bytes; everything about *where those pixels are in millimetres*
 * happens here, so FR-3 (true scale) is a pure, unit-tested property rather than a canvas-transform
 * side effect. The grid is axis-aligned in world space, so the pixel↔mm mapping is a uniform scale
 * plus a translation, and traced geometry lands at the calibrated size with no further correction.
 *
 * A layer is drawn through the homography `dstQuad → srcQuad` (F-051's two-quad model), so sampling
 * is the same map: world mm → image px → bilinear read. A rectified layer therefore traces
 * perspective-corrected without this module knowing anything about perspective.
 */

/** Hard cap on the traced grid's longest edge. Above this the trace is slow and gains no detail. */
export const TRACE_MAX_PX = 2000

/**
 * The world-aligned grid covering `quad` at `mmPerPx`, capped at `maxPx` on the longest edge (the
 * resolution is coarsened rather than the area cropped, so nothing drawn is ever lost).
 */
export function traceGridFor(quad: Quad, mmPerPx: number, maxPx = TRACE_MAX_PX): TraceGrid {
  if (!(mmPerPx > 0)) throw new Error('traceGridFor: mmPerPx must be > 0')
  const box = bboxOfPoints(quad)
  const wMm = Math.max(box.max.x - box.min.x, 1e-6)
  const hMm = Math.max(box.max.y - box.min.y, 1e-6)
  const longest = Math.max(wMm, hMm) / mmPerPx
  const scale = longest > maxPx ? longest / maxPx : 1
  const effective = mmPerPx * scale
  return {
    width: Math.max(1, Math.ceil(wMm / effective)),
    height: Math.max(1, Math.ceil(hMm / effective)),
    origin: { x: box.min.x, y: box.min.y },
    mmPerPx: effective,
  }
}

/** World mm position of the pixel centre `(x, y)` in `grid`. */
export function pixelToWorld(grid: TraceGrid, x: number, y: number): Vec2 {
  return {
    x: grid.origin.x + (x + 0.5) * grid.mmPerPx,
    y: grid.origin.y + (y + 0.5) * grid.mmPerPx,
  }
}

/**
 * Map a point given in *pixel-centre* coordinates (as {@link walkSkeleton} emits, where the centre of
 * pixel 0 is 0.5) into world mm.
 */
export function pixelPointToWorld(grid: TraceGrid, p: Vec2): Vec2 {
  return {
    x: grid.origin.x + p.x * grid.mmPerPx,
    y: grid.origin.y + p.y * grid.mmPerPx,
  }
}

/**
 * Sample `image` into `grid` through `worldToImage` (the layer's `dstQuad → srcQuad` homography),
 * bilinearly. Grid pixels whose sample falls outside the image read as paper white, so a layer that
 * does not fill its bounding box contributes no ink.
 */
export function sampleGrid(image: GreyBitmap, worldToImage: Mat3, grid: TraceGrid): GreyBitmap {
  const { width: sw, height: sh, data: src } = image
  const out = new Uint8Array(grid.width * grid.height)
  out.fill(255)
  if (sw === 0 || sh === 0) return { width: grid.width, height: grid.height, data: out }

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const world = pixelToWorld(grid, x, y)
      const p = applyHomography(worldToImage, world)
      // Image pixel centres also sit at +0.5, so subtract it before interpolating.
      const fx = p.x - 0.5
      const fy = p.y - 0.5
      if (fx < -0.5 || fy < -0.5 || fx > sw - 0.5 || fy > sh - 0.5) continue
      const x0 = Math.min(Math.max(Math.floor(fx), 0), sw - 1)
      const y0 = Math.min(Math.max(Math.floor(fy), 0), sh - 1)
      const x1 = Math.min(x0 + 1, sw - 1)
      const y1 = Math.min(y0 + 1, sh - 1)
      const tx = Math.min(Math.max(fx - x0, 0), 1)
      const ty = Math.min(Math.max(fy - y0, 0), 1)
      const v =
        src[y0 * sw + x0]! * (1 - tx) * (1 - ty) +
        src[y0 * sw + x1]! * tx * (1 - ty) +
        src[y1 * sw + x0]! * (1 - tx) * ty +
        src[y1 * sw + x1]! * tx * ty
      out[y * grid.width + x] = Math.round(v)
    }
  }
  return { width: grid.width, height: grid.height, data: out }
}
