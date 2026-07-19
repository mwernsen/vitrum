import { fitWithin, SWATCH_MAX_PX } from '@vitrum/model'

/**
 * Downscale a user-uploaded swatch image to a data URL whose longest side is at most `maxPx`,
 * preserving aspect ratio and never upscaling (F-022 FR-5). The size maths is the pure
 * `fitWithin` from `@vitrum/core`/model; this wrapper is the `<canvas>` raster step, so it lives in
 * `packages/ui` (DOM) and stays a thin, browser-only shell. Small images (already within the cap)
 * are re-encoded at their own size. Encodes to PNG to preserve any transparency.
 *
 * Rejects if the file is not a decodable image or the browser lacks a 2D canvas (e.g. jsdom).
 */
export async function downscaleImage(file: Blob, maxPx = SWATCH_MAX_PX): Promise<string> {
  const bitmap = await loadImage(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxPx)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable; cannot downscale swatch.')
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close()
  return canvas.toDataURL('image/png')
}

/** Decode a blob into something drawable, preferring `createImageBitmap`, falling back to `<img>`. */
async function loadImage(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file)
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Could not decode the selected image.'))
      img.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
