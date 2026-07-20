import { screenToWorld } from '@vitrum/core'
import { distance, type Vec2 } from '@vitrum/geometry'
import {
  addReinforcement,
  newReinforcementId,
  removeReinforcement,
  updateReinforcement,
  type Command,
  type ExecuteOptions,
  type ReinforcementBar,
  type ReinforcementMaterial,
} from '@vitrum/model'

import type { ViewportController } from '../canvas/viewport.svelte'

/** The reinforcement-bar layer's modes (F-032): off, or placing/editing bars. */
export type ReinforcementMode = 'off' | 'draw'

/** What the reinforcement layer needs from its surroundings. */
export interface ReinforcementHost {
  readonly viewport: ViewportController
  /** The document's reinforcement bars (F-032). */
  getBars(): readonly ReinforcementBar[]
  /** Apply one document command, optionally coalescing (a live endpoint drag ⇒ one undo entry). */
  execute(command: Command, options?: ExecuteOptions): void
}

/** Default dimensions for a freshly-placed bar (mm) — a typical zinc saddle bar. */
const DEFAULT_WIDTH_MM = 6
const DEFAULT_MATERIAL: ReinforcementMaterial = 'zinc'

/**
 * The reinforcement-bar controller (F-032). In **draw** mode a two-click gesture places a straight
 * bar across the panel; clicking an existing bar selects it; dragging an endpoint moves it (one undo
 * entry, coalesced); Delete removes the selected bar. Bars are a first-class document entity, drawn
 * distinctly and excluded from piece detection, so this controller only ever emits reinforcement
 * commands — it never touches the lead-line network. Kept parallel to the paint layer (F-023): a
 * dedicated interactive controller rather than an F-011 `ToolDef`, because a bar is not a
 * `SegmentDraft` and must not flow through the segment-commit path.
 */
export class ReinforcementController {
  readonly #host: ReinforcementHost

  mode = $state<ReinforcementMode>('off')
  /** The bar currently selected for editing/deletion. */
  selectedId = $state<string | null>(null)
  /** The first placed point while a bar is being drawn (null ⇒ not mid-placement). */
  start = $state<Vec2 | null>(null)
  /** The live cursor in world space, for the placement rubber-band. */
  cursor = $state<Vec2 | null>(null)

  #dragBarId: string | null = null
  #dragEnd: 'a' | 'b' | null = null

  constructor(host: ReinforcementHost) {
    this.#host = host
  }

  /** True while the layer is active (canvas routes pointers here, before drawing/edit layers). */
  get active(): boolean {
    return this.mode !== 'off'
  }

  setMode(mode: ReinforcementMode): void {
    this.mode = mode
    this.start = null
    this.#dragBarId = null
    this.#dragEnd = null
    if (mode === 'off') this.selectedId = null
  }

  /** The bar being placed as a rubber-band `[start → cursor]`, or null. */
  get placement(): { a: Vec2; b: Vec2 } | null {
    return this.start && this.cursor ? { a: this.start, b: this.cursor } : null
  }

  // --- Pointer ---------------------------------------------------------------

  pointerDown(screen: Vec2): void {
    if (this.mode !== 'draw') return
    const world = this.#world(screen)
    this.cursor = world

    // Second click of a placement: commit the bar.
    if (this.start) {
      if (distance(this.start, world) < this.#tol()) {
        // Degenerate (same point twice) — cancel rather than make a zero-length bar.
        this.start = null
        return
      }
      const bar: ReinforcementBar = {
        id: newReinforcementId(),
        a: this.start,
        b: world,
        widthMm: DEFAULT_WIDTH_MM,
        material: DEFAULT_MATERIAL,
      }
      this.#host.execute(addReinforcement(bar))
      this.selectedId = bar.id
      this.start = null
      return
    }

    // Not mid-placement: grab an endpoint, else select a bar body, else begin a new placement.
    const endpoint = this.#endpointAt(world)
    if (endpoint) {
      this.#dragBarId = endpoint.id
      this.#dragEnd = endpoint.end
      this.selectedId = endpoint.id
      return
    }
    const body = this.#barAt(world)
    if (body) {
      this.selectedId = body
      return
    }
    this.start = world
    this.selectedId = null
  }

  pointerMove(screen: Vec2): void {
    if (this.mode !== 'draw') return
    const world = this.#world(screen)
    this.cursor = world
    if (this.#dragBarId && this.#dragEnd) {
      const bar = this.#host.getBars().find((b) => b.id === this.#dragBarId)
      if (!bar) return
      const next: ReinforcementBar = { ...bar, [this.#dragEnd]: world }
      // Coalesce the whole drag into one undo entry (same key), so the doc updates live.
      this.#host.execute(updateReinforcement(next), { coalesceKey: `bar-drag-${bar.id}` })
    }
  }

  pointerUp(): void {
    this.#dragBarId = null
    this.#dragEnd = null
  }

  // --- Keyboard / editing ----------------------------------------------------

  /** Handle a key while the layer is active. Returns true when consumed. */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (!this.active) return false
    if (event.key === 'Escape') {
      if (this.start) {
        this.start = null
        return true
      }
      if (this.selectedId) {
        this.selectedId = null
        return true
      }
      return false
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedId) {
      this.deleteSelected()
      return true
    }
    return false
  }

  deleteSelected(): void {
    if (!this.selectedId) return
    this.#host.execute(removeReinforcement(this.selectedId))
    this.selectedId = null
  }

  /** The selected bar, or null. */
  selectedBar(): ReinforcementBar | null {
    return this.#host.getBars().find((b) => b.id === this.selectedId) ?? null
  }

  setWidth(widthMm: number): void {
    const bar = this.selectedBar()
    if (!bar || !Number.isFinite(widthMm) || widthMm <= 0) return
    this.#host.execute(updateReinforcement({ ...bar, widthMm }))
  }

  setMaterial(material: ReinforcementMaterial): void {
    const bar = this.selectedBar()
    if (!bar) return
    this.#host.execute(updateReinforcement({ ...bar, material }))
  }

  // --- internals -------------------------------------------------------------

  #world(screen: Vec2): Vec2 {
    return screenToWorld(this.#host.viewport.transform, screen)
  }

  /** A world-space hit tolerance that stays ~12 px on screen regardless of zoom. */
  #tol(): number {
    return 12 / Math.max(this.#host.viewport.zoomFactor, 1e-6)
  }

  #endpointAt(world: Vec2): { id: string; end: 'a' | 'b' } | null {
    const tol = this.#tol()
    for (const bar of this.#host.getBars()) {
      if (distance(world, bar.a) <= tol) return { id: bar.id, end: 'a' }
      if (distance(world, bar.b) <= tol) return { id: bar.id, end: 'b' }
    }
    return null
  }

  #barAt(world: Vec2): string | null {
    const tol = this.#tol()
    for (const bar of this.#host.getBars()) {
      if (pointToSegment(world, bar.a, bar.b) <= Math.max(tol, bar.widthMm)) return bar.id
    }
    return null
  }
}

/** Distance from point `p` to the segment `a–b`. */
function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return distance(p, a)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy })
}
