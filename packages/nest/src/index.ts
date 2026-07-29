/**
 * `@vitrum/nest` — sheet nesting & yield optimisation (F-057). A pure geometry package: given each
 * glass's cut pieces and its chosen sheet + rotation policy, lay the pieces out to minimise waste and
 * report sheet counts and utilisation. No DOM, no Svelte, no `@vitrum/model` — the UI builds the
 * structural {@link NestInput} from F-020 pieces + F-023 assignments + F-040 numbering, and the
 * document persists only the tunable intent (`Project.nesting`). The layout is a derived, fully
 * reproducible output (same input + seed → same result, FR-3).
 */
export { nestSheets } from './nest'
export { rotationsFor } from './rotation'
export { bboxBaseline, type BaselineResult } from './baseline'
export type {
  GlassNestResult,
  NestGlassInput,
  NestInput,
  NestPart,
  NestProgress,
  NestResult,
  NestRotationPolicy,
  NestSheet,
  NestSheetSize,
  PlacedPart,
} from './types'
