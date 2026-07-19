import { pieceKey, screenToWorld, type Piece } from '@vitrum/core'
import { pointInPolygon, polygon, type Vec2 } from '@vitrum/geometry'
import { setGlassAssignments, type Command, type GlassId, type PieceId } from '@vitrum/model'
import { SvelteSet } from 'svelte/reactivity'

import type { ViewportController } from '../canvas/viewport.svelte'
import type { AssignmentController } from '../glass/assignment.svelte'

/** Interaction modes owned by the paint layer (F-023), distinct from drawing (F-011) and editing. */
export type PaintMode = 'off' | 'paint' | 'select'

/** What the paint layer needs from its surroundings. */
export interface PaintHost {
  readonly viewport: ViewportController
  readonly assignments: AssignmentController
  /** The detected pieces of the live network (F-020). */
  getPieces(): readonly Piece[]
  /** Apply one document command. One gesture ⇒ exactly one call (FR-1). */
  execute(command: Command): void
}

/**
 * The paint / piece-select controller (F-023). In **paint** mode a click assigns the selected glass
 * to the piece under the cursor, a drag paints across every piece it enters (one undo step), and
 * Alt-click eyedrops a piece's glass into the selection. In **select** mode clicks pick pieces (Shift
 * to multi-select) so the inspector can show their properties and bulk-assign them. Piece hit-testing
 * is point-in-piece over the flattened rings; everything keys off the piece **content id** so
 * assignments stay reproducible across reload.
 */
export class PaintController {
  readonly #host: PaintHost

  mode = $state<PaintMode>('off')
  /** Selected piece content ids in select mode (reactive via `SvelteSet`). */
  readonly selectedPieces = new SvelteSet<PieceId>()

  #painting = false
  #dragPatch: Record<PieceId, GlassId> = {}

  constructor(host: PaintHost) {
    this.#host = host
  }

  /** True while either paint or piece-select mode is active (canvas routes pointers here). */
  get active(): boolean {
    return this.mode !== 'off'
  }

  /** Switch mode; leaving select mode clears the piece selection. */
  setMode(mode: PaintMode): void {
    if (mode !== 'select') this.selectedPieces.clear()
    this.#painting = false
    this.#dragPatch = {}
    this.mode = mode
  }

  // --- Pointer ---------------------------------------------------------------

  pointerDown(screen: Vec2, mods: { shift: boolean; alt: boolean }): void {
    const piece = this.#pieceAt(this.#world(screen))
    if (this.mode === 'paint') {
      if (!piece) return
      if (mods.alt) {
        // Eyedropper: adopt the piece's current glass as the paint colour.
        this.#host.assignments.setSelectedGlass(this.#host.assignments.glassFor(piece) ?? null)
        return
      }
      this.#painting = true
      this.#dragPatch = {}
      this.#paint(piece)
      return
    }
    if (this.mode === 'select') {
      if (!piece) {
        if (!mods.shift) this.selectedPieces.clear()
        return
      }
      const key = pieceKey(piece)
      if (mods.shift) {
        if (this.selectedPieces.has(key)) this.selectedPieces.delete(key)
        else this.selectedPieces.add(key)
      } else {
        this.selectedPieces.clear()
        this.selectedPieces.add(key)
      }
    }
  }

  pointerMove(screen: Vec2): void {
    if (!this.#painting) return
    const piece = this.#pieceAt(this.#world(screen))
    if (piece) this.#paint(piece)
  }

  pointerUp(): void {
    if (!this.#painting) return
    this.#painting = false
    const patch = this.#dragPatch
    this.#dragPatch = {}
    if (Object.keys(patch).length > 0) this.#host.execute(setGlassAssignments(patch))
  }

  // --- Bulk actions ----------------------------------------------------------

  /** Assign the selected glass to every currently-unassigned piece, in one undo step. */
  paintAllUnassigned(): void {
    const glass = this.#host.assignments.selectedGlassId
    if (!glass) return
    const patch: Record<PieceId, GlassId> = {}
    for (const piece of this.#host.getPieces()) {
      if (!this.#host.assignments.glassFor(piece)) patch[pieceKey(piece)] = glass
    }
    if (Object.keys(patch).length > 0) this.#host.execute(setGlassAssignments(patch))
  }

  /** Assign a glass to every selected piece, in one undo step. */
  assignSelected(glassId: GlassId): void {
    const patch: Record<PieceId, GlassId> = {}
    for (const key of this.selectedPieces) patch[key] = glassId
    if (Object.keys(patch).length > 0) this.#host.execute(setGlassAssignments(patch))
  }

  /** Clear the glass on every selected piece, in one undo step. */
  unassignSelected(): void {
    const patch: Record<PieceId, GlassId | null> = {}
    for (const key of this.selectedPieces) patch[key] = null
    if (Object.keys(patch).length > 0) this.#host.execute(setGlassAssignments(patch))
  }

  clearSelection(): void {
    this.selectedPieces.clear()
  }

  // --- internals -------------------------------------------------------------

  #world(screen: Vec2): Vec2 {
    return screenToWorld(this.#host.viewport.transform, screen)
  }

  /** Buffer a paint for one piece into the current drag's patch (skips no-op repaints). */
  #paint(piece: Piece): void {
    const glass = this.#host.assignments.selectedGlassId
    if (!glass) return
    const key = pieceKey(piece)
    if (this.#host.assignments.glassFor(piece) === glass) return
    this.#dragPatch[key] = glass
  }

  /** The smallest piece whose ring (minus holes) contains the point, or null. */
  #pieceAt(world: Vec2): Piece | null {
    let best: Piece | null = null
    for (const piece of this.#host.getPieces()) {
      if (pointInPolygon(polygon(piece.ring, piece.holeRings), world)) {
        if (!best || piece.area < best.area) best = piece
      }
    }
    return best
  }
}
