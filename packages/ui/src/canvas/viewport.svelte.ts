import type { LengthUnit, Viewport, ViewSize } from '@vitrum/core'
import {
  fitBounds,
  gridStep,
  makeViewport,
  panByScreen,
  scaleAround,
  screenToWorld,
  zoomBy,
} from '@vitrum/core'
import type { BBox, Vec2 } from '@vitrum/geometry'
import { vec2 } from '@vitrum/geometry'

import { defaultPxPerMm, loadCalibration } from './calibration'

/** Multiplier applied per zoom step (keyboard `+`/`-`, one wheel notch). */
const ZOOM_STEP = 1.2
/** Bounds used by zoom-to-fit when the document is empty: a default panel region. */
const DEFAULT_BOUNDS: BBox = { min: vec2(0, 0), max: vec2(300, 400) }

/**
 * The reactive owner of the canvas viewport (F-003): the world↔screen transform plus the
 * display unit, physical calibration, canvas size and cursor, exposed as Svelte runes.
 * All transform maths lives in `@vitrum/core`; this class just holds the current value
 * and turns user gestures into new viewports. Every tool (F-011+) reads through it.
 */
export class ViewportController {
  transform = $state<Viewport>(makeViewport(defaultPxPerMm(), vec2(48, 48)))
  /** Drawing-area size in CSS px (excludes the ruler gutters). */
  width = $state(0)
  height = $state(0)
  devicePixelRatio = $state(1)
  unit = $state<LengthUnit>('mm')
  gridVisible = $state(true)
  /** Construction-guide visibility (F-012). Hidden guides neither render nor snap. */
  guidesVisible = $state(true)
  /** Detected-piece overlay (F-020, dev visualization). Off by default; on ⇒ pieces run. */
  piecesVisible = $state(false)
  /** Calibrated CSS px per mm for this display, used to report 1:1 physical zoom. */
  pxPerMm = $state(defaultPxPerMm())
  /** Cursor position in drawing-area CSS px, or `null` when the pointer is away. */
  cursorScreen = $state<Vec2 | null>(null)

  #framed = false

  cursorWorld = $derived(
    this.cursorScreen ? screenToWorld(this.transform, this.cursorScreen) : null,
  )
  grid = $derived(gridStep(this.transform.scale))
  /** Zoom relative to true 1:1 physical size (1 = actual size). */
  zoomFactor = $derived(this.transform.scale / this.pxPerMm)

  constructor(unit: LengthUnit = 'mm') {
    this.unit = unit
    const calibrated = loadCalibration()
    if (calibrated !== null) this.pxPerMm = calibrated
    // Start at true 1:1 so an uncalibrated display is still close to physical scale.
    this.transform = makeViewport(this.pxPerMm, vec2(48, 48))
  }

  get size(): ViewSize {
    return { width: this.width, height: this.height }
  }

  /** Record the measured drawing-area size; frames the default view on first measure. */
  resize(width: number, height: number, dpr: number): void {
    this.width = width
    this.height = height
    this.devicePixelRatio = dpr
    if (!this.#framed && width > 0 && height > 0) {
      this.#framed = true
      this.transform = fitBounds(DEFAULT_BOUNDS, this.size)
    }
  }

  setCursor(screen: Vec2 | null): void {
    this.cursorScreen = screen
  }

  pan(deltaX: number, deltaY: number): void {
    this.transform = panByScreen(this.transform, deltaX, deltaY)
  }

  /** Zoom by `factor` anchored at a screen point (defaults to the view centre). */
  zoomAt(factor: number, anchor: Vec2 = this.#center()): void {
    this.transform = zoomBy(this.transform, factor, anchor)
  }

  zoomIn(anchor?: Vec2): void {
    this.zoomAt(ZOOM_STEP, anchor)
  }

  zoomOut(anchor?: Vec2): void {
    this.zoomAt(1 / ZOOM_STEP, anchor)
  }

  /** Snap to exact 1:1 physical size, anchored at the view centre. */
  zoomToActualSize(): void {
    this.transform = scaleAround(this.transform, this.pxPerMm, this.#center())
  }

  /** Frame `bounds` (or the default panel region when empty) with a 5% margin (FR-5). */
  zoomToFit(bounds: BBox | null): void {
    if (this.width <= 0 || this.height <= 0) return
    this.transform = fitBounds(bounds ?? DEFAULT_BOUNDS, this.size)
  }

  setUnit(unit: LengthUnit): void {
    this.unit = unit
  }

  toggleUnit(): void {
    this.unit = this.unit === 'mm' ? 'in' : 'mm'
  }

  toggleGrid(): void {
    this.gridVisible = !this.gridVisible
  }

  toggleGuides(): void {
    this.guidesVisible = !this.guidesVisible
  }

  togglePieces(): void {
    this.piecesVisible = !this.piecesVisible
  }

  /** Apply a new physical calibration (CSS px per mm) from the calibration dialog. */
  setCalibration(pxPerMm: number): void {
    if (!(Number.isFinite(pxPerMm) && pxPerMm > 0)) return
    this.pxPerMm = pxPerMm
  }

  #center(): Vec2 {
    return vec2(this.width / 2, this.height / 2)
  }
}
