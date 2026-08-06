import { expandNetwork } from '@vitrum/core'
import { outputSegments, type Project } from '@vitrum/model'
import { bboxOf, bboxUnion, type BBox } from '@vitrum/geometry'

import { segmentToWorldPoints } from './canvas/scene'

/**
 * Render a small preview of a document to PNG bytes — the one document→bitmap renderer, shared by
 * the version browser (F-055 FR-6) and the panel library grid (F-058 FR-6). Thumbnails are lead-line
 * linework (F-055 Decision §5): the symmetry-expanded output network fit to the panel bounds, drawn
 * dark on a paper ground. This is rendered document content (a design preview), so it uses fixed
 * preview colours rather than chrome tokens, mirroring the F-043 snapshot rasteriser.
 *
 * Called lazily on browse and cached, never on a save or snapshot path, so neither feature adds an
 * editing hitch. Resolves null when no 2D canvas is available (e.g. jsdom in component tests), so
 * callers show a neutral placeholder instead of erroring.
 */
const GROUND = '#f4f1ea'
const INK = '#3a3733'
const PAD = 8

export async function renderThumbnail(
  project: Project,
  width = 176,
  height = 128,
): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx || typeof canvas.toBlob !== 'function') return null
  ctx.scale(dpr, dpr)

  ctx.fillStyle = GROUND
  ctx.fillRect(0, 0, width, height)

  const segments = expandNetwork(outputSegments(project), project.symmetry)
  let bounds: BBox | null = null
  for (const seg of segments)
    bounds = bounds ? bboxUnion(bounds, bboxOf(seg.geometry)) : bboxOf(seg.geometry)

  if (bounds) {
    const bw = Math.max(bounds.max.x - bounds.min.x, 1e-6)
    const bh = Math.max(bounds.max.y - bounds.min.y, 1e-6)
    const scale = Math.min((width - PAD * 2) / bw, (height - PAD * 2) / bh)
    const offsetX = (width - bw * scale) / 2 - bounds.min.x * scale
    const offsetY = (height - bh * scale) / 2 - bounds.min.y * scale
    const toScreen = (x: number, y: number) => ({ x: x * scale + offsetX, y: y * scale + offsetY })

    ctx.strokeStyle = INK
    ctx.lineWidth = 1
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    for (const seg of segments) {
      const points = segmentToWorldPoints(seg.geometry)
      ctx.beginPath()
      points.forEach((p, i) => {
        const s = toScreen(p.x, p.y)
        if (i === 0) ctx.moveTo(s.x, s.y)
        else ctx.lineTo(s.x, s.y)
      })
      ctx.stroke()
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return null
  return new Uint8Array(await blob.arrayBuffer())
}
