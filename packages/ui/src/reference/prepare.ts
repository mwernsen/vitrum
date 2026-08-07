import { downscaleSize, orientRgba, orientationSwapsAxes, readExifOrientation } from '@vitrum/core'

/**
 * Decode an imported image, downscale it to the F-051 cap (longest edge ≤ 4096 px) and re-encode it
 * so the embedded blob stays small. PNG sources keep their alpha (re-encoded PNG); everything else
 * becomes JPEG. Browser-only (canvas/`createImageBitmap`); the pure size policy lives in
 * `@vitrum/core`'s {@link downscaleSize}, and callers in tests inject a prepared asset instead.
 *
 * **EXIF orientation is resolved here, once** (added by F-059). A phone photo stores the sensor
 * readout and records which way up it was in a tag; the two obvious ways to read it disagree —
 * `createImageBitmap`'s `imageOrientation` default has changed across specs and engines, and the
 * committed F-059 reference photo is a real specimen of the mess (upright pixels, stale `orientation
 * = 6`). So the tag is applied explicitly, by `@vitrum/core`'s pure `orientRgba`, and then baked into
 * the re-encoded asset: from that point on the stored bytes carry no orientation question, and the
 * WebGL underlay and the autotrace rasteriser cannot disagree about which way up the panel is. That
 * agreement is what matters — the user places the calibration and the rectification corners on what
 * they can see.
 */

export interface PreparedImage {
  readonly bytes: Uint8Array
  readonly mime: string
  readonly width: number
  readonly height: number
}

export async function prepareReferenceImage(
  bytes: Uint8Array,
  mime: string,
): Promise<PreparedImage> {
  if (typeof createImageBitmap === 'undefined') {
    throw new Error('Image import needs a browser environment (createImageBitmap unavailable).')
  }
  const orientation = readExifOrientation(bytes)
  const sourceBlob = new Blob([toArrayBuffer(bytes)], { type: mime || 'image/png' })
  // Never the decoder's default: the tag is applied below, from our own reader.
  const bitmap = await createImageBitmap(sourceBlob, { imageOrientation: 'none' })
  try {
    const target = downscaleSize(bitmap.width, bitmap.height)
    const canvas = makeCanvas(target.width, target.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get a 2D context to downscale the image.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, target.width, target.height)
    // Rotating after the downscale is the same picture for a fraction of the work — a rotation
    // commutes with a uniform scale, and there are up to 16 million fewer pixels to move.
    const upright = orientation === 1 ? canvas : orientCanvas(ctx, target, orientation)
    const swap = orientationSwapsAxes(orientation)
    // Keep PNG (alpha) for PNG sources; re-encode photos as JPEG to bound file size.
    const outMime = mime === 'image/png' ? 'image/png' : 'image/jpeg'
    const outBlob = await encode(upright, outMime, 0.85)
    return {
      bytes: new Uint8Array(await outBlob.arrayBuffer()),
      mime: outBlob.type || outMime,
      width: swap ? target.height : target.width,
      height: swap ? target.width : target.height,
    }
  } finally {
    bitmap.close()
  }
}

/** Apply an EXIF orientation to a drawn canvas, returning a correctly-sized new one. */
function orientCanvas(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  size: { width: number; height: number },
  orientation: ReturnType<typeof readExifOrientation>,
): HTMLCanvasElement | OffscreenCanvas {
  const rgba = ctx.getImageData(0, 0, size.width, size.height)
  const oriented = orientRgba(rgba.data, rgba.width, rgba.height, orientation)
  const out = makeCanvas(oriented.width, oriented.height)
  const outCtx = out.getContext('2d') as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!outCtx) throw new Error('Could not get a 2D context to orient the image.')
  // Via the context's own `createImageData`, not the `ImageData` constructor: it hands back a buffer
  // the canvas already owns, so no cast is needed to satisfy its narrower array type.
  const image = outCtx.createImageData(oriented.width, oriented.height)
  image.data.set(oriented.data)
  outCtx.putImageData(image, 0, 0)
  return out
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

async function encode(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  mime: string,
  quality: number,
): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: mime, quality })
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality))
  if (!blob) throw new Error('Could not encode the downscaled image.')
  return blob
}

/** Copy into a plain ArrayBuffer so Blob gets a non-shared BlobPart. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}
