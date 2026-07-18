import type { Vec2 } from '@vitrum/geometry'

/**
 * The snap vocabulary (F-012). Kinds are listed in **priority order**: when the cursor is
 * within the snap radius of candidates of several kinds, the earliest kind in this list
 * wins, and within one kind the nearest candidate wins (FR-2). The order is the contract —
 * do not reorder without updating the acceptance tests.
 */
export type SnapKind = 'endpoint' | 'intersection' | 'midpoint' | 'on-curve' | 'grid' | 'angle'

/** The snap kinds in priority order. `resolveSnap` walks this to pick a winner. */
export const SNAP_KINDS: readonly SnapKind[] = [
  'endpoint',
  'intersection',
  'midpoint',
  'on-curve',
  'grid',
  'angle',
]

/** Per-kind on/off switches. */
export type SnapToggles = Record<SnapKind, boolean>

/**
 * All snapping configuration. `master` is the global enable — the temporary-disable
 * modifier (FR-3) clears it for as long as the key is held. Radii are in **screen pixels**
 * and zoom-independent (resolved by the Open-question decision: 8 px mouse, 12 px pen/touch,
 * chosen via `PointerEvent.pointerType`); the UI converts the active radius to world mm
 * before it reaches the engine, so the engine itself stays unit-agnostic.
 */
export interface SnapSettings {
  readonly toggles: SnapToggles
  readonly master: boolean
  readonly radiusMousePx: number
  readonly radiusPenPx: number
}

export const DEFAULT_SNAP_SETTINGS: SnapSettings = {
  toggles: {
    endpoint: true,
    intersection: true,
    midpoint: true,
    'on-curve': true,
    grid: true,
    angle: true,
  },
  master: true,
  radiusMousePx: 8,
  radiusPenPx: 12,
}

/**
 * A resolved snap. `world` is the point the pointer is pulled to — for an endpoint snap it
 * is the target node's exact stored coordinate, so a welded endpoint is bit-identical to
 * the node it welds to (FR-1). `guides` are alignment lines (angle/extension snaps) the
 * overlay draws so the user sees why the cursor jumped.
 */
export interface SnapHit {
  readonly kind: SnapKind
  readonly world: Vec2
  readonly guides?: readonly (readonly [Vec2, Vec2])[]
}
