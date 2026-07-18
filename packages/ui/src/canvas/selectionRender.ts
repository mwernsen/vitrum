import type { MarqueeMode, Viewport } from '@vitrum/core'
import { worldToScreen } from '@vitrum/core'
import { applyToPoint, type Transform2D, type Vec2 } from '@vitrum/geometry'
import type { Segment } from '@vitrum/model'

import type { CanvasPalette } from './render'
import { segmentToWorldPoints } from './scene'

/**
 * The selection / editing overlay (F-013): selected segments highlighted in the cobalt action
 * accent, endpoint node glyphs, bézier control handles, the transform bounding box with its
 * handles, the marquee rectangle (solid = window, dashed = crossing), and a live transform
 * preview. Everything is drawn on the overlay layer through design tokens (no glass colours),
 * and every call is guarded on a null 2D context so component tests under jsdom are unaffected.
 */
export interface EditRenderState {
  readonly selected: readonly Segment[]
  readonly nodeMarkers: readonly Vec2[]
  readonly bezierHandles: readonly { readonly anchor: Vec2; readonly control: Vec2 }[]
  readonly handles: readonly { readonly id: string; readonly world: Vec2 }[]
  readonly bbox: { readonly min: Vec2; readonly max: Vec2 } | null
  readonly marquee: { readonly from: Vec2; readonly to: Vec2; readonly mode: MarqueeMode } | null
  readonly preview: {
    readonly transform: Transform2D
    readonly segments: readonly Segment[]
  } | null
}

const HANDLE = 4 // half-size in screen px

function strokePolyline(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  points: readonly Vec2[],
  transform?: Transform2D,
): void {
  ctx.beginPath()
  points.forEach((p, i) => {
    const w = transform ? applyToPoint(transform, p) : p
    const s = worldToScreen(vp, w)
    if (i === 0) ctx.moveTo(s.x, s.y)
    else ctx.lineTo(s.x, s.y)
  })
  ctx.stroke()
}

export function drawEditLayer(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  state: EditRenderState,
  palette: CanvasPalette,
): void {
  if (!ctx) return
  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // Highlighted selected segments.
  ctx.strokeStyle = palette.selection
  ctx.lineWidth = 2.5
  ctx.setLineDash([])
  for (const seg of state.selected) strokePolyline(ctx, vp, segmentToWorldPoints(seg.geometry))

  // Live transform preview (ghosted, dashed).
  if (state.preview) {
    ctx.save()
    ctx.globalAlpha = 0.7
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 1.75
    ctx.strokeStyle = palette.selection
    for (const seg of state.preview.segments) {
      strokePolyline(ctx, vp, segmentToWorldPoints(seg.geometry), state.preview.transform)
    }
    ctx.restore()
  }

  // Transform bounding box + handles.
  if (state.bbox && state.handles.length > 0) {
    const a = worldToScreen(vp, state.bbox.min)
    const b = worldToScreen(vp, state.bbox.max)
    ctx.save()
    ctx.strokeStyle = palette.handle
    ctx.globalAlpha = 0.6
    ctx.lineWidth = 1
    ctx.setLineDash([3, 3])
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
    ctx.restore()

    ctx.fillStyle = palette.rulerBg
    ctx.strokeStyle = palette.handle
    ctx.lineWidth = 1.5
    ctx.setLineDash([])
    for (const h of state.handles) {
      const s = worldToScreen(vp, h.world)
      if (h.id === 'rotate') {
        ctx.beginPath()
        ctx.arc(s.x, s.y, HANDLE, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      } else {
        ctx.fillRect(s.x - HANDLE, s.y - HANDLE, HANDLE * 2, HANDLE * 2)
        ctx.strokeRect(s.x - HANDLE, s.y - HANDLE, HANDLE * 2, HANDLE * 2)
      }
    }
  }

  // Bézier control handles (line from anchor to control + a dot).
  if (state.bezierHandles.length > 0) {
    ctx.strokeStyle = palette.handle
    ctx.fillStyle = palette.handle
    ctx.lineWidth = 1
    ctx.setLineDash([])
    for (const { anchor, control } of state.bezierHandles) {
      const a = worldToScreen(vp, anchor)
      const c = worldToScreen(vp, control)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(c.x, c.y)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(c.x, c.y, HANDLE - 0.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Endpoint node glyphs (small filled squares).
  ctx.fillStyle = palette.selection
  ctx.setLineDash([])
  for (const p of state.nodeMarkers) {
    const s = worldToScreen(vp, p)
    ctx.fillRect(s.x - 3, s.y - 3, 6, 6)
  }

  // Marquee rectangle.
  if (state.marquee) {
    const a = worldToScreen(vp, state.marquee.from)
    const b = worldToScreen(vp, state.marquee.to)
    ctx.strokeStyle = palette.selection
    ctx.lineWidth = 1
    ctx.setLineDash(state.marquee.mode === 'crossing' ? [4, 3] : [])
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    ctx.setLineDash([])
  }

  ctx.restore()
}
