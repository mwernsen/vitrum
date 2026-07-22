/**
 * Reference-image import helpers (F-051). Pure size arithmetic only — the actual decode and
 * re-encode is a browser (canvas) concern and lives in `packages/ui`; keeping the cap policy here
 * means it is unit-tested and shared. A large photo or scan is downscaled at import so project
 * files stay small and a 4K underlay does not blow the GPU texture budget (FR-4).
 */

/** The default cap on an imported image's longest edge, in pixels (decided at F-051 expansion). */
export const REFERENCE_IMAGE_MAX_PX = 4096

export interface ImageSize {
  readonly width: number
  readonly height: number
}

/**
 * The target pixel size for an imported image: unchanged when it already fits within `cap` on its
 * longest edge, otherwise scaled down preserving aspect ratio (rounded, never below 1 px). Never
 * upscales.
 */
export function downscaleSize(
  width: number,
  height: number,
  cap: number = REFERENCE_IMAGE_MAX_PX,
): ImageSize {
  const longest = Math.max(width, height)
  if (longest <= cap || longest === 0) return { width, height }
  const factor = cap / longest
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  }
}
