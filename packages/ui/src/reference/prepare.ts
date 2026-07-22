import { downscaleSize } from '@vitrum/core'

/**
 * Decode an imported image, downscale it to the F-051 cap (longest edge ≤ 4096 px) and re-encode it
 * so the embedded blob stays small. PNG sources keep their alpha (re-encoded PNG); everything else
 * becomes JPEG. Browser-only (canvas/`createImageBitmap`); the pure size policy lives in
 * `@vitrum/core`'s {@link downscaleSize}, and callers in tests inject a prepared asset instead.
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
  const sourceBlob = new Blob([toArrayBuffer(bytes)], { type: mime || 'image/png' })
  const bitmap = await createImageBitmap(sourceBlob)
  try {
    const target = downscaleSize(bitmap.width, bitmap.height)
    const canvas = makeCanvas(target.width, target.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not get a 2D context to downscale the image.')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, target.width, target.height)
    // Keep PNG (alpha) for PNG sources; re-encode photos as JPEG to bound file size.
    const outMime = mime === 'image/png' ? 'image/png' : 'image/jpeg'
    const outBlob = await encode(canvas, outMime, 0.85)
    return {
      bytes: new Uint8Array(await outBlob.arrayBuffer()),
      mime: outBlob.type || outMime,
      width: target.width,
      height: target.height,
    }
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
