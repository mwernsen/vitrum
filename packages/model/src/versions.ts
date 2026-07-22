import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import type { Project } from './types'

/**
 * Version history (F-055): automatic + manual snapshots of a document, stored in the app-data
 * directory outside the document/undo model (like the glass library and autosave). This module is
 * the pure, framework-free core: the structural delta that makes storage compact, the keyframe +
 * delta archive that holds the snapshots, and the sharing helpers. The UI's `VersionController`
 * mirrors it into runes and persists through a {@link VersionPort}; nothing here touches Svelte,
 * the DOM or Electron.
 *
 * Storage strategy (Decision §3/§4): rather than persisting F-002's semantic command log (which the
 * store does not expose), each snapshot is stored as a **structural delta** against the previous
 * one, with a full **keyframe** every {@link KEYFRAME_INTERVAL} snapshots. Only changed entities
 * travel in a delta, so a heavy session stays well under the storage budget (FR-4), while
 * {@link diffProject}/{@link applyProjectDelta} guarantee an exact restore (FR-2).
 */

export const VERSION_ARCHIVE_VERSION = 1

/** A full keyframe is stored every Nth snapshot; the rest are deltas against the previous snapshot. */
export const KEYFRAME_INTERVAL = 10

/** How many automatic snapshots to retain by default; every named version is kept regardless (FR-4). */
export const DEFAULT_MAX_AUTO_SNAPSHOTS = 100

export type SnapshotKind = 'auto' | 'manual'

/** The user-facing description of a snapshot (everything the browser lists). */
export interface SnapshotMeta {
  readonly id: string
  /** Epoch milliseconds when the snapshot was taken. */
  readonly createdAt: number
  readonly kind: SnapshotKind
  /** A manual version's name (absent for automatic snapshots). */
  readonly label?: string
  /** An optional note attached to a manual version. */
  readonly note?: string
}

/* -------------------------------------------------------------------------- */
/* Structural delta                                                            */
/* -------------------------------------------------------------------------- */

type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue }

/**
 * A structural patch node. Either replace a value wholesale (`$set` — used for primitives, arrays
 * and type changes) or descend into an object, patching per-key and deleting removed keys (`$obj` /
 * `$del`). Applying a node produced by {@link diffValue} to its base reproduces the target exactly.
 */
export type ProjectDelta =
  | { readonly $set: JsonValue }
  | { readonly $obj: Record<string, ProjectDelta>; readonly $del?: readonly string[] }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((x, i) => deepEqual(x, b[i]))
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    return ka.every((k) => k in b && deepEqual(a[k], b[k]))
  }
  return false
}

function diffValue(a: unknown, b: unknown): ProjectDelta | null {
  if (deepEqual(a, b)) return null
  if (isPlainObject(a) && isPlainObject(b)) {
    const obj: Record<string, ProjectDelta> = {}
    const del: string[] = []
    for (const key of Object.keys(a)) if (!(key in b)) del.push(key)
    for (const key of Object.keys(b)) {
      if (!(key in a)) obj[key] = { $set: clone(b[key]) as JsonValue }
      else {
        const sub = diffValue(a[key], b[key])
        if (sub) obj[key] = sub
      }
    }
    return del.length > 0 ? { $obj: obj, $del: del } : { $obj: obj }
  }
  return { $set: clone(b) as JsonValue }
}

function applyValue(a: unknown, patch: ProjectDelta): unknown {
  if ('$set' in patch) return clone(patch.$set)
  const base: Record<string, unknown> = isPlainObject(a) ? { ...a } : {}
  for (const key of patch.$del ?? []) delete base[key]
  for (const [key, sub] of Object.entries(patch.$obj)) base[key] = applyValue(base[key], sub)
  return base
}

/** The structural delta that upgrades `a` into `b`, or null when they are already deep-equal. */
export function diffProject(a: Project, b: Project): ProjectDelta {
  return diffValue(a, b) ?? { $obj: {} }
}

/** Apply a {@link diffProject} delta to `a`, reproducing the target document exactly (FR-2). */
export function applyProjectDelta(a: Project, delta: ProjectDelta): Project {
  return applyValue(a, delta) as Project
}

/* -------------------------------------------------------------------------- */
/* Archive                                                                     */
/* -------------------------------------------------------------------------- */

/** A stored snapshot: a full keyframe (`project`) or a delta against the previous snapshot (`delta`). */
interface StoredSnapshot {
  readonly meta: SnapshotMeta
  readonly project?: Project
  readonly delta?: ProjectDelta
}

/** The persisted, chronological (oldest-first) history of one document. */
export interface VersionArchive {
  readonly version: number
  readonly snapshots: readonly StoredSnapshot[]
}

export function emptyArchive(): VersionArchive {
  return { version: VERSION_ARCHIVE_VERSION, snapshots: [] }
}

/** The metadata of every snapshot, oldest first. Callers reverse for a newest-first browser. */
export function listSnapshots(archive: VersionArchive): SnapshotMeta[] {
  return archive.snapshots.map((s) => s.meta)
}

/** Reconstruct a snapshot's full document by resolving from its nearest keyframe forward (FR-2). */
export function resolveSnapshot(archive: VersionArchive, id: string): Project | null {
  const index = archive.snapshots.findIndex((s) => s.meta.id === id)
  if (index < 0) return null
  // Walk back to the nearest keyframe (a snapshot carrying a full `project`).
  let start = index
  while (start > 0 && !archive.snapshots[start]!.project) start--
  let doc = clone(archive.snapshots[start]!.project!)
  for (let i = start + 1; i <= index; i++) {
    const snap = archive.snapshots[i]!
    if (snap.project) doc = clone(snap.project)
    else if (snap.delta) doc = applyProjectDelta(doc, snap.delta)
  }
  return doc
}

/** Append a snapshot, storing it as a keyframe or a delta against the previous one. */
function append(archive: VersionArchive, meta: SnapshotMeta, project: Project): VersionArchive {
  const isKeyframe = archive.snapshots.length % KEYFRAME_INTERVAL === 0
  let snapshot: StoredSnapshot
  if (isKeyframe) {
    snapshot = { meta, project: clone(project) }
  } else {
    const prev = archive.snapshots.at(-1)!
    const prevProject = resolveSnapshot(archive, prev.meta.id)!
    snapshot = { meta, delta: diffProject(prevProject, project) }
  }
  return { ...archive, snapshots: [...archive.snapshots, snapshot] }
}

/** Options for {@link addSnapshot}: identity + kind are caller-supplied so the module stays pure. */
export interface AddSnapshotOptions {
  readonly id: string
  readonly createdAt: number
  readonly kind: SnapshotKind
  readonly label?: string
  readonly note?: string
}

/** Record a new snapshot of `project` (FR-1/FR-3). */
export function addSnapshot(
  archive: VersionArchive,
  project: Project,
  opts: AddSnapshotOptions,
): VersionArchive {
  const meta: SnapshotMeta = {
    id: opts.id,
    createdAt: opts.createdAt,
    kind: opts.kind,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  }
  return append(archive, meta, project)
}

/** Rebuild the archive from an ordered list of resolved snapshots, recomputing keyframes/deltas. */
function rebuild(entries: readonly { meta: SnapshotMeta; project: Project }[]): VersionArchive {
  let archive = emptyArchive()
  for (const e of entries) archive = append(archive, e.meta, e.project)
  return archive
}

function resolveAll(archive: VersionArchive): { meta: SnapshotMeta; project: Project }[] {
  return archive.snapshots.map((s) => ({
    meta: s.meta,
    project: resolveSnapshot(archive, s.meta.id)!,
  }))
}

/**
 * Delete a snapshot. Every remaining snapshot stays restorable even if the deleted one was a base
 * for a later delta (FR-5): the survivors are resolved and the archive rebuilt.
 */
export function deleteSnapshot(archive: VersionArchive, id: string): VersionArchive {
  if (!archive.snapshots.some((s) => s.meta.id === id)) return archive
  return rebuild(resolveAll(archive).filter((e) => e.meta.id !== id))
}

/** Rename / re-note a snapshot (metadata only — no reconstruction needed). */
export function renameSnapshot(
  archive: VersionArchive,
  id: string,
  patch: { label?: string; note?: string },
): VersionArchive {
  return {
    ...archive,
    snapshots: archive.snapshots.map((s) => {
      if (s.meta.id !== id) return s
      const meta: SnapshotMeta = {
        id: s.meta.id,
        createdAt: s.meta.createdAt,
        kind: 'manual',
        ...(patch.label !== undefined
          ? patch.label === ''
            ? {}
            : { label: patch.label }
          : s.meta.label !== undefined
            ? { label: s.meta.label }
            : {}),
        ...(patch.note !== undefined
          ? patch.note === ''
            ? {}
            : { note: patch.note }
          : s.meta.note !== undefined
            ? { note: s.meta.note }
            : {}),
      }
      return { ...s, meta }
    }),
  }
}

/**
 * Prune automatic snapshots to a budget (FR-4): every manual (named) version is kept; among the
 * automatic ones only the most recent `maxAuto` survive, oldest dropped first. Chronological order
 * is preserved and the archive is rebuilt so every survivor resolves.
 */
export function pruneArchive(
  archive: VersionArchive,
  maxAuto: number = DEFAULT_MAX_AUTO_SNAPSHOTS,
): VersionArchive {
  const entries = resolveAll(archive)
  const autoIndices = entries
    .map((e, i) => ({ i, kind: e.meta.kind }))
    .filter((x) => x.kind === 'auto')
    .map((x) => x.i)
  if (autoIndices.length <= maxAuto) return archive
  const dropCount = autoIndices.length - maxAuto
  const drop = new Set(autoIndices.slice(0, dropCount))
  return rebuild(entries.filter((_, i) => !drop.has(i)))
}

/* -------------------------------------------------------------------------- */
/* Serialization                                                               */
/* -------------------------------------------------------------------------- */

/** Thrown when an archive was written by a newer Vitrum than this build understands. */
export class VersionArchiveVersionError extends Error {
  constructor(readonly fileVersion: number) {
    super(
      `This version history uses format ${fileVersion}, but this build understands up to ` +
        `${VERSION_ARCHIVE_VERSION}.`,
    )
    this.name = 'VersionArchiveVersionError'
  }
}

/**
 * Serialize the archive to compressed bytes for persistence (FR-4). The whole archive is one JSON
 * document then deflated: cross-snapshot redundancy (deltas already carry only changes; keyframes
 * repeat) compresses hard, keeping a heavy session well under budget.
 */
export function serializeArchive(archive: VersionArchive): Uint8Array {
  const json = JSON.stringify(archive)
  return zipSync({ 'history.json': strToU8(json) }, { level: 6 })
}

/** Parse archive bytes, rejecting a newer format and tolerating an empty/absent history. */
export function deserializeArchive(bytes: Uint8Array): VersionArchive {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch (cause) {
    throw new Error('Not a valid version history: the contents are not a valid archive.', { cause })
  }
  const entry = files['history.json']
  if (!entry) return emptyArchive()
  const parsed = JSON.parse(strFromU8(entry)) as VersionArchive
  if (typeof parsed.version === 'number' && parsed.version > VERSION_ARCHIVE_VERSION) {
    throw new VersionArchiveVersionError(parsed.version)
  }
  return { version: VERSION_ARCHIVE_VERSION, snapshots: parsed.snapshots ?? [] }
}

/* -------------------------------------------------------------------------- */
/* Sharing (FR-7 / FR-8)                                                       */
/* -------------------------------------------------------------------------- */

/** A copy of the project flagged for a read-only shared hand-off, with an optional watermark note. */
export function sharedProject(project: Project, note?: string): Project {
  const trimmed = note?.trim()
  return {
    ...project,
    settings: {
      ...project.settings,
      sharedReadOnly: true,
      ...(trimmed ? { shareNote: trimmed } : {}),
    },
  }
}

/** True when a document was opened from a shared package and should be read-only (FR-8). */
export function isReadOnly(project: Project): boolean {
  return project.settings.sharedReadOnly === true
}

/** An editable copy of a shared document: drops the read-only flag and the share note (FR-8). */
export function editableCopy(project: Project): Project {
  const settings = { ...project.settings }
  delete (settings as { sharedReadOnly?: boolean }).sharedReadOnly
  delete (settings as { shareNote?: string }).shareNote
  return { ...project, settings }
}

/* -------------------------------------------------------------------------- */
/* Persistence port                                                            */
/* -------------------------------------------------------------------------- */

/**
 * How version history reaches persistent storage. On the desktop it is backed by files in the
 * app-data directory (`userData/versions/<key>/…`); in a plain browser and in tests it is stubbed.
 * Keyed by a per-document key (the file path, or `scratch` for an unsaved document) so different
 * files keep separate histories (Decision §1). Mirrors F-002's `StoragePort` / F-022's
 * `GlassLibraryPort` split so `packages/ui` stays Electron-free.
 */
export interface VersionPort {
  /** Read the persisted archive bytes for a document key, or null if none exists yet. */
  loadArchive(key: string): Promise<Uint8Array | null>
  /** Persist the archive bytes for a document key. */
  saveArchive(key: string, bytes: Uint8Array): Promise<void>
  /** Read a cached thumbnail (PNG bytes) for a snapshot, or null if not yet rendered (FR-6). */
  loadThumbnail(key: string, id: string): Promise<Uint8Array | null>
  /** Cache a rendered thumbnail (PNG bytes) for a snapshot (FR-6). */
  saveThumbnail(key: string, id: string, bytes: Uint8Array): Promise<void>
}
