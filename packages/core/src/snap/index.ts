/**
 * Snapping & spatial indexing (F-012). Pure and framework-free: the snap engine and the
 * grid-hash index are consumed by the UI's pointer-resolver hook (F-011 seam) and will be
 * reused by selection hit-testing (F-013) and DRC (F-030).
 */

export { GridIndex } from './spatialIndex'
export {
  buildSnapScene,
  curveEndpoints,
  resolveSnap,
  type SnapQuery,
  type SnapScene,
  type SnapTarget,
} from './snap'
export {
  DEFAULT_SNAP_SETTINGS,
  SNAP_KINDS,
  type SnapHit,
  type SnapKind,
  type SnapSettings,
  type SnapToggles,
} from './types'
