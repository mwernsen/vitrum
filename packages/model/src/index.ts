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
  defaultCurrency,
  defaultLaborModel,
  defaultLightSettings,
  defaultNestingSettings,
  defaultNumbering,
  defaultPriceBook,
  defaultQuoteSettings,
  defaultRenderSettings,
  defaultSymmetry,
  identityTextureTransform,
  type AssetId,
  type BomSettings,
  type ConsumableLine,
  type Currency,
  type DrcExclusion,
  type DrcRuleOverride,
  type DrcState,
  type Glass,
  type GlassId,
  type LaborModel,
  type LayerId,
  type GlassNestConfig,
  type LightMode,
  type LightSettings,
  type NestingSettings,
  type NestRotationPolicy,
  type NestStrategy,
  type Node,
  type NodeId,
  type NumberingScheme,
  type NumberingState,
  type PieceId,
  type PieceTextureTransform,
  type PriceBook,
  type Project,
  type ProjectSettings,
  type QuoteClient,
  type QuoteLineItem,
  type QuoteSettings,
  type ReferenceAsset,
  type ReferenceLayer,
  type ReinforcementBar,
  type ReinforcementId,
  type ReinforcementMaterial,
  type RenderSettings,
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

// Global price book (F-056)
export {
  deserializePriceBook,
  normalizePriceBook,
  PRICE_BOOK_VERSION,
  PriceBookVersionError,
  serializePriceBook,
  type PriceBookPort,
} from './priceBook'

// Ids and factories
export {
  newConsumableId,
  newCameProfileId,
  newGlassId,
  newLayerId,
  newNodeId,
  newQuoteLineId,
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

// T-junction welding for committed gestures (F-011/F-013)
export {
  JUNCTION_TOLERANCE,
  addSegmentsWelded,
  planWeldedCommit,
  type SegmentDraftLike,
  type WeldedCommit,
} from './junctions'

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
  replaceProject,
  replaceSegments,
  setCameOverride,
  setDrcExclusion,
  setDrcRuleOverride,
  setGlassAssignments,
  setPieceTextureTransforms,
  setSegmentRole,
  sequence,
  setSymmetry,
  setTechniqueKind,
  splitSegmentAtNode,
  transformSegments,
  updateBomSettings,
  updateFoilSettings,
  updateLeadSettings,
  updateLightSettings,
  updateNestingSettings,
  updateNumbering,
  updateQuoteSettings,
  updateReferenceLayer,
  updateReinforcement,
  updateRenderSettings,
  updateSegmentGeometry,
  updateSegmentsGeometry,
  updateSettings,
  upsertCameProfile,
  upsertGlass,
  type Command,
  type LightSettingsPatch,
  type NumberingPatch,
  type ReferenceLayerPatch,
  type RenderBacklightPatch,
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

// Version history & sharing (F-055)
export {
  addSnapshot,
  applyProjectDelta,
  DEFAULT_MAX_AUTO_SNAPSHOTS,
  deleteSnapshot,
  deserializeArchive,
  diffProject,
  editableCopy,
  emptyArchive,
  isReadOnly,
  KEYFRAME_INTERVAL,
  listSnapshots,
  pruneArchive,
  renameSnapshot,
  resolveSnapshot,
  serializeArchive,
  sharedProject,
  VERSION_ARCHIVE_VERSION,
  VersionArchiveVersionError,
  type AddSnapshotOptions,
  type ProjectDelta,
  type SnapshotKind,
  type SnapshotMeta,
  type VersionArchive,
  type VersionPort,
} from './versions'

// Panel library & launch screen (F-058)
export {
  createPanelProject,
  deserializePanelLibrary,
  emptyPanelLibrary,
  forgetPanel,
  MAX_LIBRARY_ENTRIES,
  PANEL_LIBRARY_VERSION,
  panelEntryFor,
  panelThumbnailKey,
  recordPanelOpened,
  relocatePanel,
  serializePanelLibrary,
  type LibraryPort,
  type NewPanelSpec,
  type PanelEntry,
  type PanelLibrary,
} from './library'

// Storage port
export type { OpenedFile, StoragePort } from './storage'

// Autosave
export { Autosaver, type AutosaverOptions, type Scheduler, type TimerHandle } from './autosave'
