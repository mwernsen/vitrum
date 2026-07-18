/**
 * Selection hit-testing and marquee (F-013). Pure and framework-free: it reuses the F-012
 * spatial index for O(local) picks and measures true curve distance, so the UI's selection
 * controller stays a thin reactive shell over tested logic.
 */

export {
  buildPickScene,
  pickNode,
  pickSegment,
  pickSegments,
  type NodeTarget,
  type PickHit,
  type PickScene,
  type PickTarget,
} from './pick'
export { marqueeMode, marqueeSelect, type MarqueeMode } from './marquee'
