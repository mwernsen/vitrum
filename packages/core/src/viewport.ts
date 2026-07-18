import { type BBox, type Vec2, bboxCenter, bboxHeight, bboxWidth, vec2 } from '@vitrum/geometry'

import type { LengthUnit } from './units'

/**
 * The world↔screen transform (F-003). World coordinates are millimetres; screen
 * coordinates are CSS pixels relative to the canvas top-left. The Y axis is **Y-down**
 * (resolved F-003 open question): world +Y and screen +Y both point down, so the
 * transform is a uniform positive scale with no axis flip.
 *
 * A plain `{ scale, offset }` value, not an affine matrix: rotation is deliberately not
 * a requirement, so a full matrix buys nothing (F-003 technical guidance). All functions
 * are pure and return a new `Viewport`; the reactive UI layer owns the current value.
 */
export interface Viewport {
  /** CSS pixels per world millimetre. Always > 0. */
  readonly scale: number
  /** Screen position (CSS px, from canvas top-left) of the world origin. */
  readonly offset: Vec2
}

/** Screen size of the drawing area, in CSS pixels. */
export interface ViewSize {
  readonly width: number
  readonly height: number
}

/**
 * Zoom bounds, expressed as CSS px per mm. The lower bound frames a ~40 m panel in a
 * pocket-sized viewport; the upper bound is ~260× the 96-dpi physical scale. Both sit
 * well outside the 0.01×–1000× round-trip range FR-1 tests, which is the point.
 */
export const MIN_SCALE = 0.01
export const MAX_SCALE = 1000

/** The CSS-reference physical scale: 96 CSS px per inch ÷ 25.4 mm per inch. */
export const CSS_PX_PER_MM = 96 / 25.4

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function makeViewport(scale: number, offset: Vec2): Viewport {
  return { scale: clampScale(scale), offset }
}

/** Map a world point (mm) to a screen point (CSS px). */
export function worldToScreen(vp: Viewport, world: Vec2): Vec2 {
  return vec2(world.x * vp.scale + vp.offset.x, world.y * vp.scale + vp.offset.y)
}

/** Map a screen point (CSS px) back to a world point (mm). */
export function screenToWorld(vp: Viewport, screen: Vec2): Vec2 {
  return vec2((screen.x - vp.offset.x) / vp.scale, (screen.y - vp.offset.y) / vp.scale)
}

/** Pan by a screen-space delta (CSS px): the content follows the pointer. */
export function panByScreen(vp: Viewport, deltaX: number, deltaY: number): Viewport {
  return { scale: vp.scale, offset: vec2(vp.offset.x + deltaX, vp.offset.y + deltaY) }
}

/**
 * Set an absolute scale while keeping the world point under `anchor` (a screen point)
 * fixed on screen. This is the primitive behind cursor-anchored zoom (FR-2).
 */
export function scaleAround(vp: Viewport, nextScale: number, anchor: Vec2): Viewport {
  const scale = clampScale(nextScale)
  const world = screenToWorld(vp, anchor)
  // Choose the offset that maps `world` back onto `anchor` at the new scale.
  return { scale, offset: vec2(anchor.x - world.x * scale, anchor.y - world.y * scale) }
}

/** Multiply the current scale by `factor`, anchored at a screen point (FR-2). */
export function zoomBy(vp: Viewport, factor: number, anchor: Vec2): Viewport {
  return scaleAround(vp, vp.scale * factor, anchor)
}

/**
 * Frame `bounds` (a world-space box) inside `view` with a symmetric margin (FR-5:
 * 5% ⇒ the document fills the middle 90% of each axis). A degenerate axis (zero width
 * or height, e.g. a single point or a horizontal line) is ignored when choosing the
 * scale; if both axes are degenerate the physical scale is used so the point stays put.
 */
export function fitBounds(bounds: BBox, view: ViewSize, margin = 0.05): Viewport {
  const usableW = view.width * (1 - 2 * margin)
  const usableH = view.height * (1 - 2 * margin)
  const w = bboxWidth(bounds)
  const h = bboxHeight(bounds)

  const scaleX = w > 0 ? usableW / w : Infinity
  const scaleY = h > 0 ? usableH / h : Infinity
  const raw = Math.min(scaleX, scaleY)
  const scale = clampScale(Number.isFinite(raw) ? raw : CSS_PX_PER_MM)

  const center = bboxCenter(bounds)
  return {
    scale,
    offset: vec2(view.width / 2 - center.x * scale, view.height / 2 - center.y * scale),
  }
}

/** The world rectangle currently visible in a `view` of the given size. */
export function visibleWorldBounds(vp: Viewport, view: ViewSize): BBox {
  const min = screenToWorld(vp, vec2(0, 0))
  const max = screenToWorld(vp, vec2(view.width, view.height))
  return { min, max }
}

/** An adaptive grid's minor and major spacing, in world millimetres. */
export interface GridStep {
  readonly minor: number
  readonly major: number
}

/**
 * Snap a raw world length up to the nearest "nice" step on the 1/5/10 ladder (…, 1, 5,
 * 10, 50, 100 mm …), matching the grid steps F-003 calls for.
 */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1
  const decade = Math.pow(10, Math.floor(Math.log10(raw)))
  for (const mantissa of [1, 5, 10]) {
    const candidate = mantissa * decade
    if (candidate >= raw - raw * 1e-9) return candidate
  }
  return 10 * decade
}

/**
 * Choose the adaptive grid spacing for a zoom `scale` (CSS px/mm): the finest 1/5/10
 * step whose minor lines are at least `minMinorPx` apart on screen. Major lines land on
 * the next rung up (1→5, 5→10, 10→50, …), so the ladder is exactly 1/5/10/50/100 mm.
 */
export function gridStep(scale: number, minMinorPx = 8): GridStep {
  const minor = niceStep(minMinorPx / scale)
  const decade = Math.pow(10, Math.floor(Math.log10(minor) + 1e-9))
  const mantissa = Math.round(minor / decade)
  const major = mantissa === 1 ? minor * 5 : minor * 2
  return { minor, major }
}

/** Inch subdivisions a ruler labels, coarse → fine, in inches. */
const INCH_LADDER = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 5, 10, 25, 50, 100]
const MM_PER_INCH = 25.4

/**
 * The spacing between labelled ruler ticks, in world millimetres, so labels stay at
 * least `minLabelPx` apart. Steps are "nice" in the *display* unit — mm uses the
 * 1/2/5 decade ladder, inches use natural fractions (1/16", 1/8", …, 1", 2", …) — so
 * the numbers a designer reads are always round in the unit they picked (FR-3).
 */
export function rulerStepMm(scale: number, unit: LengthUnit, minLabelPx = 56): number {
  const rawMm = minLabelPx / scale
  if (unit === 'in') {
    const rawIn = rawMm / MM_PER_INCH
    const step = INCH_LADDER.find((s) => s >= rawIn) ?? INCH_LADDER[INCH_LADDER.length - 1]!
    return step * MM_PER_INCH
  }
  const decade = Math.pow(10, Math.floor(Math.log10(rawMm)))
  for (const mantissa of [1, 2, 5, 10]) {
    const candidate = mantissa * decade
    if (candidate >= rawMm - rawMm * 1e-9) return candidate
  }
  return 10 * decade
}

/**
 * The multiples of `step` that fall within `[lo, hi]` (a world-axis span), inclusive of
 * touching endpoints. Used to place grid lines and ruler ticks across the visible range.
 */
export function ticksInRange(lo: number, hi: number, step: number): number[] {
  if (step <= 0 || !Number.isFinite(step)) return []
  const start = Math.ceil(lo / step - 1e-9)
  const end = Math.floor(hi / step + 1e-9)
  // Guard against pathological zoom producing an unbounded tick count.
  if (end - start > 100_000) return []
  const ticks: number[] = []
  for (let i = start; i <= end; i++) ticks.push(i * step)
  return ticks
}
