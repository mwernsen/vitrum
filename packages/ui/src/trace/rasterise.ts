import {
  TRACE_MAX_PX,
  orientRgba,
  readExifOrientation,
  rgbaToGrey,
  sampleGrid,
  traceGridFor,
  type GreyBitmap,
  type TraceGrid,
} from '@vitrum/core'
import { bboxOfPoints, homographyFromQuadToQuad } from '@vitrum/geometry'
import type { ReferenceAsset, ReferenceLayer } from '@vitrum/model'

/**
 * Turning an F-051 reference layer into the pixel grid autotrace runs on (F-059).
 *
 * This is the only DOM-touching part of the feature: the browser decodes the layer's stored image
 * bytes, and everything about *where those pixels are in millimetres* is `@vitrum/core`'s pure,
 * unit-tested `sampleGrid` / `traceGridFor`. The result is a world-**axis-aligned** greyscale grid, so
 * a layer whose perspective F-051 has already corrected traces rectified without this module knowing
 * anything about perspective — it just walks the layer's own `dstQuad → srcQuad` homography.
 *
 * ## Why there is no EXIF rotation here
 *
 * A phone photo carries its orientation in an EXIF tag rather than in its pixels, and ignoring it
 * traces the panel sideways. That is handled **once**, at F-051 import (`reference/prepare.ts`):
 * the imported bytes are decoded with `imageOrientation: 'none'`, the tag is applied by
 * `@vitrum/core`'s `orientRgba`, and the result is re-encoded — so a stored `ReferenceAsset` has the
 * rotation baked into its pixels and carries no tag. Re-applying a tag here would be the same bug
 * inverted: the trace would come out rotated relative to the underlay the user placed their
 * calibration and rectification corners on, and *that* agreement is the actual requirement.
 *
 * The tag is still read below, because it costs nothing and makes the guarantee total: for a prepared
 * asset it is 1 and the call is the identity, and if raw camera bytes ever reach a layer by another
 * route they are oriented rather than traced sideways.
 */

export interface TraceSource {
  /** The layer resampled into a world-aligned greyscale grid. */
  readonly image: GreyBitmap
  /** How that grid sits in world millimetres. */
  readonly grid: TraceGrid
}

/** Thrown when a layer's world size has never been measured, so its mm are meaningless (FR-3). */
export class UncalibratedLayerError extends Error {
  constructor() {
    super(
      'This reference image has not been calibrated, so its size in millimetres is a placeholder. ' +
        'Calibrate it first — select the layer and use "Calibrate scale…", or "Correct perspective…" ' +
        'if the photo is at an angle — then trace.',
    )
    this.name = 'UncalibratedLayerError'
  }
}

/**
 * Resample `layer` into a world-aligned greyscale grid ready for `traceBitmap`.
 *
 * Refuses an uncalibrated layer outright (FR-3): a freshly placed layer is scaled to an arbitrary
 * 300 mm, and tracing it would emit lead lines at a size nobody measured. Guessing a DPI instead is
 * exactly what the requirement forbids.
 */
export async function rasteriseLayer(
  layer: ReferenceLayer,
  asset: ReferenceAsset,
  maxPx: number = TRACE_MAX_PX,
): Promise<TraceSource> {
  if (!layer.calibrated) throw new UncalibratedLayerError()
  const grey = await decodeToGrey(asset)
  const grid = traceGridFor(layer.dstQuad, millimetresPerImagePixel(layer), maxPx)
  const worldToImage = homographyFromQuadToQuad(layer.dstQuad, layer.srcQuad)
  return { image: sampleGrid(grey, worldToImage, grid), grid }
}

/**
 * The world size of one image pixel, in mm — the resolution to resample at, so the trace neither
 * throws detail away nor invents it. Taken as the **finer** of the two axes, because an un-rectified
 * layer may be anisotropic and undersampling one axis loses linework.
 */
export function millimetresPerImagePixel(layer: ReferenceLayer): number {
  const src = bboxOfPoints(layer.srcQuad)
  const dst = bboxOfPoints(layer.dstQuad)
  const srcW = Math.max(src.max.x - src.min.x, 1)
  const srcH = Math.max(src.max.y - src.min.y, 1)
  const dstW = Math.max(dst.max.x - dst.min.x, 1e-6)
  const dstH = Math.max(dst.max.y - dst.min.y, 1e-6)
  return Math.max(Math.min(dstW / srcW, dstH / srcH), 1e-6)
}

/** Decode stored image bytes to greyscale, honouring any EXIF orientation they still carry. */
async function decodeToGrey(asset: ReferenceAsset): Promise<GreyBitmap> {
  if (typeof createImageBitmap === 'undefined') {
    throw new Error('Autotrace needs a browser environment (createImageBitmap unavailable).')
  }
  const blob = new Blob([asset.bytes.slice().buffer], { type: asset.mime || 'image/png' })
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'none' })
  try {
    const canvas = makeCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d') as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!ctx) throw new Error('Could not get a 2D context to read the reference image.')
    ctx.drawImage(bitmap, 0, 0)
    const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
    const orientation = readExifOrientation(asset.bytes)
    if (orientation === 1) return rgbaToGrey(rgba.data, rgba.width, rgba.height)
    const oriented = orientRgba(rgba.data, rgba.width, rgba.height, orientation)
    return rgbaToGrey(oriented.data, oriented.width, oriented.height)
  } finally {
    bitmap.close()
  }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}
