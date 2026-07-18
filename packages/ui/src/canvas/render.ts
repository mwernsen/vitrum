import type { LengthUnit, Viewport, ViewSize } from '@vitrum/core'
import {
  formatFractionalInch,
  gridStep,
  rulerStepMm,
  ticksInRange,
  visibleWorldBounds,
  worldToScreen,
} from '@vitrum/core'
import type { BBox, Vec2 } from '@vitrum/geometry'
import { bboxExpand, bboxOf, bboxOverlap, vec2 } from '@vitrum/geometry'
import type { Segment } from '@vitrum/model'

import { segmentToWorldPoints } from './scene'

/**
 * Colours the canvas chrome (grid, rulers, crosshair) draws with, resolved from the
 * design-token ramp at runtime so the 2D canvas honours the same palette as the DOM
 * (F-003 Design: ink/paper ramp). Only leaf tokens (literal colours) are read — semantic
 * aliases resolve to `var(...)` in `getComputedStyle` and would not be usable here.
 * Rendered document content is data-driven and token-exempt, but we still draw it from
 * the ramp for now since no glass colours exist yet.
 */
export interface CanvasPalette {
  readonly gridMinor: string
  readonly gridMajor: string
  readonly axis: string
  readonly cursor: string
  readonly content: string
  readonly construction: string
  readonly rulerBg: string
  readonly rulerBorder: string
  readonly rulerTick: string
  readonly rulerText: string
}

const FALLBACK: CanvasPalette = {
  gridMinor: 'rgba(255,255,255,.14)',
  gridMajor: '#bcbcb4',
  axis: '#d9d9d2',
  cursor: '#2f63e8',
  content: '#fafaf8',
  construction: '#6b6b68',
  rulerBg: '#ffffff',
  rulerBorder: '#e9e9e4',
  rulerTick: '#d9d9d2',
  rulerText: '#6b6b68',
}

/** Read the canvas palette from an element's resolved custom properties. */
export function readCanvasPalette(el: HTMLElement): CanvasPalette {
  const cs = getComputedStyle(el)
  const read = (name: string, fallback: string): string =>
    cs.getPropertyValue(name).trim() || fallback
  return {
    gridMinor: read('--border-dark', FALLBACK.gridMinor),
    gridMajor: read('--paper-400', FALLBACK.gridMajor),
    axis: read('--paper-300', FALLBACK.axis),
    cursor: read('--cobalt-500', FALLBACK.cursor),
    content: read('--paper-50', FALLBACK.content),
    construction: read('--ink-500', FALLBACK.construction),
    rulerBg: read('--paper-0', FALLBACK.rulerBg),
    rulerBorder: read('--paper-200', FALLBACK.rulerBorder),
    rulerTick: read('--paper-300', FALLBACK.rulerTick),
    rulerText: read('--ink-500', FALLBACK.rulerText),
  }
}

/** Ruler thickness in CSS px (top ruler height / left ruler width). */
export const RULER_SIZE = 22

/**
 * Size a canvas's backing store for HiDPI and return a context whose transform maps CSS
 * pixels 1:1 (so all drawing code works in CSS px). Returns `null` where 2D canvas is
 * unavailable (e.g. jsdom in component tests), which every draw call tolerates.
 */
export function prepareContext(
  canvas: HTMLCanvasElement,
  size: ViewSize,
  dpr: number,
): CanvasRenderingContext2D | null {
  const backingW = Math.max(1, Math.round(size.width * dpr))
  const backingH = Math.max(1, Math.round(size.height * dpr))
  if (canvas.width !== backingW) canvas.width = backingW
  if (canvas.height !== backingH) canvas.height = backingH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size.width, size.height)
  return ctx
}

function crisp(v: number): number {
  return Math.round(v) + 0.5
}

/** Draw the adaptive grid and world axes. Redrawn only when the viewport changes. */
export function drawGrid(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  size: ViewSize,
  palette: CanvasPalette,
): void {
  if (!ctx) return
  const { minor, major } = gridStep(vp.scale)
  const world = visibleWorldBounds(vp, size)

  const verticals = (step: number, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const x of ticksInRange(world.min.x, world.max.x, step)) {
      const sx = crisp(worldToScreen(vp, vec2(x, 0)).x)
      ctx.moveTo(sx, 0)
      ctx.lineTo(sx, size.height)
    }
    for (const y of ticksInRange(world.min.y, world.max.y, step)) {
      const sy = crisp(worldToScreen(vp, vec2(0, y)).y)
      ctx.moveTo(0, sy)
      ctx.lineTo(size.width, sy)
    }
    ctx.stroke()
  }

  verticals(minor, palette.gridMinor)
  verticals(major, palette.gridMajor)

  // World axes (x = 0, y = 0), drawn a touch stronger so the origin is findable.
  ctx.strokeStyle = palette.axis
  ctx.lineWidth = 1
  ctx.beginPath()
  const origin = worldToScreen(vp, vec2(0, 0))
  if (origin.x >= 0 && origin.x <= size.width) {
    ctx.moveTo(crisp(origin.x), 0)
    ctx.lineTo(crisp(origin.x), size.height)
  }
  if (origin.y >= 0 && origin.y <= size.height) {
    ctx.moveTo(0, crisp(origin.y))
    ctx.lineTo(size.width, crisp(origin.y))
  }
  ctx.stroke()
}

/**
 * Draw the document's lead-line network, culling segments outside the visible region so
 * cost tracks what's on screen, not the document size (FR-4).
 */
export function drawContent(
  ctx: CanvasRenderingContext2D | null,
  vp: Viewport,
  size: ViewSize,
  segments: readonly Segment[],
  palette: CanvasPalette,
): void {
  if (!ctx) return
  const visible = bboxExpand(visibleWorldBounds(vp, size), 5)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  for (const segment of segments) {
    const box: BBox = bboxOf(segment.geometry)
    if (!bboxOverlap(box, visible)) continue

    const construction = segment.role === 'construction'
    ctx.strokeStyle = construction ? palette.construction : palette.content
    ctx.lineWidth = segment.role === 'border' ? 2 : 1.25
    ctx.setLineDash(construction ? [4, 4] : [])

    const points = segmentToWorldPoints(segment.geometry)
    ctx.beginPath()
    points.forEach((p, i) => {
      const s = worldToScreen(vp, p)
      if (i === 0) ctx.moveTo(s.x, s.y)
      else ctx.lineTo(s.x, s.y)
    })
    ctx.stroke()
  }
  ctx.setLineDash([])
}

/** Draw the cursor crosshair. Its own layer so pointer moves never redraw content. */
export function drawOverlay(
  ctx: CanvasRenderingContext2D | null,
  size: ViewSize,
  cursorScreen: Vec2 | null,
  palette: CanvasPalette,
): void {
  if (!ctx || !cursorScreen) return
  ctx.strokeStyle = palette.cursor
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.7
  ctx.beginPath()
  ctx.moveTo(crisp(cursorScreen.x), 0)
  ctx.lineTo(crisp(cursorScreen.x), size.height)
  ctx.moveTo(0, crisp(cursorScreen.y))
  ctx.lineTo(size.width, crisp(cursorScreen.y))
  ctx.stroke()
  ctx.globalAlpha = 1
}

function rulerLabel(mm: number, unit: LengthUnit): string {
  if (unit === 'in') return formatFractionalInch(mm)
  const rounded = Math.round(mm * 100) / 100
  return String(rounded)
}

/**
 * Draw the top (horizontal) or left (vertical) ruler: a token-styled gutter with ticks
 * at nice, unit-aware intervals and a marker tracking the cursor (FR-3). `lengthPx` is
 * the extent along the ruler; the cross dimension is {@link RULER_SIZE}.
 */
export function drawRuler(
  ctx: CanvasRenderingContext2D | null,
  axis: 'x' | 'y',
  vp: Viewport,
  lengthPx: number,
  unit: LengthUnit,
  cursorScreen: Vec2 | null,
  palette: CanvasPalette,
): void {
  if (!ctx) return
  const horizontal = axis === 'x'
  const size: ViewSize = horizontal
    ? { width: lengthPx, height: RULER_SIZE }
    : { width: RULER_SIZE, height: lengthPx }

  ctx.fillStyle = palette.rulerBg
  ctx.fillRect(0, 0, size.width, size.height)

  const stepMm = rulerStepMm(vp.scale, unit)
  // World span along this axis. The ruler canvas shares its origin edge with the drawing
  // area, so the same viewport offset keeps ticks aligned with the grid — no gutter shift.
  const lo = horizontal ? (0 - vp.offset.x) / vp.scale : (0 - vp.offset.y) / vp.scale
  const hi = horizontal ? (lengthPx - vp.offset.x) / vp.scale : (lengthPx - vp.offset.y) / vp.scale

  ctx.strokeStyle = palette.rulerTick
  ctx.fillStyle = palette.rulerText
  ctx.lineWidth = 1
  ctx.font = '10px "Geist Mono", ui-monospace, monospace'
  ctx.textBaseline = 'alphabetic'

  for (const world of ticksInRange(Math.min(lo, hi), Math.max(lo, hi), stepMm)) {
    const pos = horizontal
      ? worldToScreen(vp, vec2(world, 0)).x
      : worldToScreen(vp, vec2(0, world)).y
    const label = rulerLabel(world, unit)

    ctx.beginPath()
    if (horizontal) {
      ctx.moveTo(crisp(pos), RULER_SIZE - 6)
      ctx.lineTo(crisp(pos), RULER_SIZE)
      ctx.stroke()
      ctx.textAlign = 'left'
      ctx.fillText(label, pos + 3, RULER_SIZE - 8)
    } else {
      ctx.moveTo(RULER_SIZE - 6, crisp(pos))
      ctx.lineTo(RULER_SIZE, crisp(pos))
      ctx.stroke()
      // Rotate labels to read bottom-to-top so long fractional-inch strings fit the gutter.
      ctx.save()
      ctx.translate(RULER_SIZE - 8, pos - 3)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'left'
      ctx.fillText(label, 0, 0)
      ctx.restore()
    }
  }

  // Border on the inner edge (against the canvas), and the cursor marker.
  ctx.strokeStyle = palette.rulerBorder
  ctx.beginPath()
  if (horizontal) {
    ctx.moveTo(0, crisp(RULER_SIZE))
    ctx.lineTo(lengthPx, crisp(RULER_SIZE))
  } else {
    ctx.moveTo(crisp(RULER_SIZE), 0)
    ctx.lineTo(crisp(RULER_SIZE), lengthPx)
  }
  ctx.stroke()

  if (cursorScreen) {
    ctx.strokeStyle = palette.cursor
    ctx.beginPath()
    if (horizontal) {
      ctx.moveTo(crisp(cursorScreen.x), 0)
      ctx.lineTo(crisp(cursorScreen.x), RULER_SIZE)
    } else {
      ctx.moveTo(0, crisp(cursorScreen.y))
      ctx.lineTo(RULER_SIZE, crisp(cursorScreen.y))
    }
    ctx.stroke()
  }
}
