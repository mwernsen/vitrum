/**
 * `@vitrum/model` — the document model (F-002): the in-memory project, the command
 * pattern that is the only way to mutate it, unlimited undo/redo, and versioned
 * save/load. Pure TypeScript with no Svelte, DOM or Electron dependency; `packages/ui`
 * subscribes through a thin adapter and the host supplies file access via `StoragePort`.
 */

// Domain types
export {
  createEmptyProject,
  type Glass,
  type GlassId,
  type LayerId,
  type Project,
  type ProjectSettings,
  type ReferenceLayer,
  type Segment,
  type SegmentGeometry,
  type SegmentId,
  type SegmentRole,
  type TechniqueSettings,
} from './types'

// Ids and factories
export { newGlassId, newLayerId, newSegmentId } from './ids'
export { createSegment } from './factory'

// Commands
export {
  addSegment,
  addSegments,
  removeSegment,
  removeSegments,
  replaceSegments,
  setSegmentRole,
  updateSegmentGeometry,
  updateSettings,
  type Command,
} from './commands'

// Network queries
export { constructionSegmentIds, isOutputSegment, outputSegments } from './network'

// Store
export { DocumentStore, type ExecuteOptions, type Listener } from './store'

// Persistence
export {
  CURRENT_SCHEMA_VERSION,
  deserialize,
  MIGRATIONS,
  SchemaVersionError,
  serialize,
  type Migration,
  type VitrumFile,
} from './serialize'

// Storage port
export type { OpenedFile, StoragePort } from './storage'

// Autosave
export { Autosaver, type AutosaverOptions, type Scheduler, type TimerHandle } from './autosave'
