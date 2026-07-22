/**
 * `@vitrum/model` — the document model (F-002): the in-memory project, the command
 * pattern that is the only way to mutate it, unlimited undo/redo, and versioned
 * save/load. Pure TypeScript with no Svelte, DOM or Electron dependency; `packages/ui`
 * subscribes through a thin adapter and the host supplies file access via `StoragePort`.
 */

// Domain types
export {
  createEmptyProject,
  defaultBomSettings,
  defaultNumbering,
  defaultSymmetry,
  type AssetId,
  type BomSettings,
  type DrcExclusion,
  type DrcRuleOverride,
  type DrcState,
  type Glass,
  type GlassId,
  type LayerId,
  type Node,
  type NodeId,
  type NumberingScheme,
  type NumberingState,
  type PieceId,
  type Project,
  type ProjectSettings,
  type ReferenceAsset,
  type ReferenceLayer,
  type ReinforcementBar,
  type ReinforcementId,
  type ReinforcementMaterial,
  type Segment,
  type SegmentGeometry,
  type SegmentId,
  type SegmentRole,
  type Severity,
  type SheetSize,
  type SymmetryMode,
  type SymmetrySetup,
  type TextureTag,
  type TransparencyClass,
} from './types'

// Glass catalog (F-022)
export {
  cloneGlass,
  filterGlasses,
  fitWithin,
  hexToHsl,
  hueBucket,
  HUE_BUCKETS,
  matchesGlass,
  parseHex,
  starterGlasses,
  STARTER_GLASSES,
  SWATCH_MAX_PX,
  TEXTURE_TAGS,
  TRANSPARENCY_CLASSES,
  type GlassFilter,
  type HueBucket,
} from './glass'

// Global glass library (F-022)
export {
  createStarterLibrary,
  deserializeLibrary,
  duplicateGlassInLibrary,
  emptyLibrary,
  GLASS_LIBRARY_VERSION,
  GlassLibraryVersionError,
  libraryGlasses,
  mergeLibrary,
  removeGlassFromLibrary,
  serializeLibrary,
  upsertGlassInLibrary,
  type GlassLibrary,
  type GlassLibraryPort,
} from './glassLibrary'

// Technique model (F-021)
export {
  SEED_CAME_PROFILES,
  defaultTechnique,
  seedCameLibrary,
  type CameKind,
  type CameOverride,
  type CameProfile,
  type CameProfileId,
  type FoilSettings,
  type LeadSettings,
  type SolderFinish,
  type TechniqueKind,
  type TechniqueSettings,
} from './technique'

// Ids and factories
export {
  newCameProfileId,
  newGlassId,
  newLayerId,
  newNodeId,
  newReinforcementId,
  newSegmentId,
} from './ids'
export { createSegment, weldSegments } from './factory'

// Node helpers (F-013)
export {
  arcDemotionIds,
  demoteArcSegment,
  geometryEndpoints,
  incidentEndpoints,
  keepsKind,
  reconcileNodes,
  reconcileProjectNodes,
  referencedNodeIds,
  segmentsFromDrafts,
  setGeometryEndpoint,
  synthesizeNodes,
  transformGeometry,
} from './nodes'

// Commands
export {
  addReferenceLayer,
  addReinforcement,
  addSegment,
  addSegments,
  bakeSymmetry,
  deleteNode,
  mergeNodes,
  moveNode,
  removeCameProfile,
  removeGlass,
  removeReferenceLayer,
  removeReinforcement,
  removeSegment,
  removeSegments,
  reorderReferenceLayers,
  replaceSegments,
  setCameOverride,
  setDrcExclusion,
  setDrcRuleOverride,
  setGlassAssignments,
  setSegmentRole,
  setSymmetry,
  setTechniqueKind,
  splitSegmentAtNode,
  transformSegments,
  updateBomSettings,
  updateFoilSettings,
  updateLeadSettings,
  updateNumbering,
  updateReferenceLayer,
  updateReinforcement,
  updateSegmentGeometry,
  updateSegmentsGeometry,
  updateSettings,
  upsertCameProfile,
  upsertGlass,
  type Command,
  type NumberingPatch,
  type ReferenceLayerPatch,
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

// File container — zip with embedded image assets (F-051)
export { assetIdFor, packDocument, unpackDocument, type UnpackedDocument } from './container'

// Storage port
export type { OpenedFile, StoragePort } from './storage'

// Autosave
export { Autosaver, type AutosaverOptions, type Scheduler, type TimerHandle } from './autosave'
