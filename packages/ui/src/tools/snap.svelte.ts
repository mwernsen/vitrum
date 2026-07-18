import {
  DEFAULT_SNAP_SETTINGS,
  buildSnapScene,
  resolveSnap,
  type PointerResolver,
  type SnapHit,
  type SnapKind,
  type SnapScene,
  type SnapToggles,
} from '@vitrum/core'
import type { Segment } from '@vitrum/model'

import type { ViewportController } from '../canvas/viewport.svelte'

/** Which pointer devices get the wider snap radius (resolved Open question). */
type PointerType = 'mouse' | 'pen' | 'touch' | ''

/**
 * The snapping controller (F-012): the reactive owner of the snap engine that decorates the
 * F-011 pointer-resolution hook. It holds the snap settings (per-kind toggles + master),
 * keeps a spatial-index scene over the current segments, and exposes {@link resolver} — the
 * `PointerResolver` swapped into `ToolController.resolver`, replacing the v1 identity stub
 * with zero tool changes.
 *
 * Settings live as mutable runes here (the engine's `SnapSettings` is deeply readonly), and
 * are assembled into a `SnapSettings` per resolve. The active snap (`hit`) is a rune so the
 * canvas overlay redraws its marker whenever the resolved snap changes. Everything is
 * browser-safe (runes + pure `@vitrum/core`); no DOM or Electron.
 */
export class SnapController {
  readonly #viewport: ViewportController

  /** Master enable. The temporary-disable modifier (FR-3) suspends snapping on top of this. */
  master = $state(DEFAULT_SNAP_SETTINGS.master)
  /** Per-kind on/off switches, deep-reactive so the settings popover takes effect live. */
  toggles = $state<SnapToggles>({ ...DEFAULT_SNAP_SETTINGS.toggles })
  readonly radiusMousePx = DEFAULT_SNAP_SETTINGS.radiusMousePx
  readonly radiusPenPx = DEFAULT_SNAP_SETTINGS.radiusPenPx

  /** The snap the last pointer resolution produced, or `null`. Drives the overlay marker. */
  hit = $state<SnapHit | null>(null)

  /** Pointer device of the latest event; picks the 8 px (mouse) vs 12 px (pen/touch) radius. */
  #pointerType: PointerType = 'mouse'
  /** True while the temporary-disable modifier is held (FR-3). */
  #snapOff = false

  #scene: SnapScene = buildSnapScene([])

  constructor(viewport: ViewportController) {
    this.#viewport = viewport
  }

  /** Rebuild the spatial index for a new set of snap targets (call when segments change). */
  updateScene(segments: readonly Segment[]): void {
    this.#scene = buildSnapScene(segments.map((s) => ({ geometry: s.geometry })))
  }

  /** Record the pointer device and whether the temporary-disable modifier is held. */
  setPointer(pointerType: string, snapOff: boolean): void {
    this.#pointerType = (pointerType as PointerType) || 'mouse'
    this.#snapOff = snapOff
  }

  /** Clear any active snap marker (pointer left the canvas / gesture ended). */
  clear(): void {
    if (this.hit !== null) this.hit = null
  }

  toggle(kind: SnapKind): void {
    this.toggles[kind] = !this.toggles[kind]
  }

  toggleMaster(): void {
    this.master = !this.master
  }

  /** The snap radius in screen px for the current pointer device. */
  get radiusPx(): number {
    return this.#pointerType === 'mouse' ? this.radiusMousePx : this.radiusPenPx
  }

  /**
   * The F-011 pointer resolver. Runs the snap engine against the current scene and viewport,
   * stores the winning snap for the overlay, and returns the (possibly snapped) world point.
   * Screen-space radius is converted to world mm by the viewport scale, so it is
   * zoom-independent.
   */
  resolver: PointerResolver = (world, ctx) => {
    const scale = this.#viewport.transform.scale
    const hit = resolveSnap(this.#scene, {
      world,
      radiusMm: this.radiusPx / scale,
      gridMm: this.toggles.grid ? this.#viewport.grid.minor : null,
      anchors: ctx.anchors,
      settings: {
        toggles: this.toggles,
        master: this.master && !this.#snapOff,
        radiusMousePx: this.radiusMousePx,
        radiusPenPx: this.radiusPenPx,
      },
    })
    this.hit = hit
    return hit ? { world: hit.world, snap: { kind: hit.kind, world: hit.world } } : { world }
  }
}
