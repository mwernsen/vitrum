import {
  addSnapshot,
  deleteSnapshot,
  deserializeArchive,
  emptyArchive,
  listSnapshots,
  pruneArchive,
  renameSnapshot,
  resolveSnapshot,
  serializeArchive,
  type Project,
  type SnapshotKind,
  type SnapshotMeta,
  type VersionArchive,
  type VersionPort,
} from '@vitrum/model'

import { SvelteMap } from 'svelte/reactivity'

import { renderThumbnail } from './thumbnail'

/** After this many document changes since the last snapshot, take an automatic one (Decision §2). */
const AUTO_COMMAND_THRESHOLD = 24
/** …or after this long has elapsed while dirty, whichever comes first (Decision §2). */
const AUTO_TIME_MS = 90_000

/** The document key for an unsaved (never-saved) document — its history is scoped to the session. */
export const SCRATCH_KEY = 'scratch'

/** What the controller needs from the document layer, injected so it stays testable and decoupled. */
export interface VersionControllerDeps {
  /** The live document, read when a snapshot is taken. */
  getDoc: () => Project
  /** Replace the working document as a single undoable step (F-055 restore, FR-2). */
  restore: (project: Project) => void
  /** Load a snapshot as a fresh untitled document, leaving the current file untouched (open copy). */
  openCopy: (project: Project) => void
  /** Persistent storage for archives + thumbnails. Absent ⇒ history is in-memory for the session. */
  port?: VersionPort
  /** Clock, injected for deterministic tests. */
  now?: () => number
  /** Fresh snapshot id, injected for deterministic tests. */
  newId?: () => string
  /** Serialize a document for the "unchanged since last snapshot" guard. */
  serialize?: (project: Project) => string
  /** Render a snapshot thumbnail (PNG bytes), injected so the DOM stays out of tests. */
  renderThumbnail?: (project: Project) => Promise<Uint8Array | null>
}

/**
 * The reactive bridge to a document's version history (F-055). It mirrors the framework-free
 * {@link VersionArchive} into runes, owns the automatic-snapshot heuristic and the user operations
 * (save version / restore / open copy / rename / delete), and persists through a {@link VersionPort}
 * (per-document, keyed by file path — Decision §1). Thumbnails are rendered lazily on browse and
 * cached to disk (FR-6), never at snapshot time.
 *
 * Like the glass library (F-022), version history is app-level state, not part of the document/undo
 * model — restoring re-enters the document through a single undoable command, keeping the store the
 * sole mutator.
 */
export class VersionController {
  readonly #deps: VersionControllerDeps
  readonly #now: () => number
  readonly #newId: () => string
  readonly #serialize: (project: Project) => string

  #archive: VersionArchive = emptyArchive()
  #key = SCRATCH_KEY
  #lastJson: string | null = null
  #commands = 0
  #lastAt = 0

  /** Snapshots newest-first, for the browser. */
  snapshots = $state<SnapshotMeta[]>([])
  /** True once the archive for the current document key has loaded. */
  loaded = $state(false)
  /** Cache of snapshot id → thumbnail data URL (null = rendered but unavailable → placeholder). */
  #thumbs = new SvelteMap<string, string | null>()

  constructor(deps: VersionControllerDeps) {
    this.#deps = deps
    this.#now = deps.now ?? Date.now
    this.#newId = deps.newId ?? defaultId
    this.#serialize = deps.serialize ?? ((p) => JSON.stringify(p))
    this.#lastAt = this.#now()
  }

  /**
   * Point the controller at a document key (its file path, or {@link SCRATCH_KEY} when unsaved) and
   * load that document's archive. Resets the auto-snapshot baseline to the current document, so the
   * next automatic snapshot captures accumulated edits rather than the loaded state.
   */
  useDocument = async (path: string | null): Promise<void> => {
    const key = path ?? SCRATCH_KEY
    if (key === this.#key && this.loaded) return
    this.#key = key
    this.#thumbs.clear()
    this.#archive = emptyArchive()
    if (this.#deps.port) {
      const bytes = await this.#deps.port.loadArchive(key)
      if (bytes) {
        try {
          this.#archive = deserializeArchive(bytes)
        } catch {
          this.#archive = emptyArchive()
        }
      }
    }
    this.#resetBaseline()
    this.#refresh()
    this.loaded = true
  }

  /**
   * Record a document change (FR-1). Takes an automatic snapshot once the command-count or time
   * threshold since the last snapshot is crossed, and never while the document is clean or unchanged.
   */
  onChange = (dirty: boolean): void => {
    if (!dirty) {
      this.#resetBaseline()
      return
    }
    this.#commands++
    const elapsed = this.#now() - this.#lastAt
    if (this.#commands >= AUTO_COMMAND_THRESHOLD || elapsed >= AUTO_TIME_MS) {
      void this.#takeAuto()
    }
  }

  /** Save a manual named version now (FR-3). Always records an entry, even if unchanged. */
  saveVersion = async (label: string, note?: string): Promise<void> => {
    await this.#add(this.#deps.getDoc(), 'manual', label.trim() || 'Untitled version', note?.trim())
  }

  /** Restore a snapshot as a single undoable step, replacing the working document (FR-2). */
  restore = (id: string): boolean => {
    const project = resolveSnapshot(this.#archive, id)
    if (!project) return false
    this.#deps.restore(project)
    return true
  }

  /** Open a snapshot as a fresh untitled copy, leaving the current file untouched (FR-2). */
  openCopy = (id: string): boolean => {
    const project = resolveSnapshot(this.#archive, id)
    if (!project) return false
    this.#deps.openCopy(project)
    return true
  }

  /** Rename / re-note a version (FR-5). */
  rename = async (id: string, patch: { label?: string; note?: string }): Promise<void> => {
    this.#archive = renameSnapshot(this.#archive, id, patch)
    this.#refresh()
    await this.#persist()
  }

  /** Delete a version; remaining versions stay restorable (FR-5). */
  remove = async (id: string): Promise<void> => {
    this.#archive = deleteSnapshot(this.#archive, id)
    this.#thumbs.delete(id)
    this.#refresh()
    await this.#persist()
  }

  /**
   * Kick off a lazy thumbnail render for a snapshot if one is not already cached (FR-6). Safe to
   * call repeatedly; the first call per id triggers the disk-cache → render → cache pipeline. Call
   * from an effect (it mutates reactive state), then read the result via {@link thumbnailUrl}.
   */
  requestThumbnail = (id: string): void => {
    if (this.#thumbs.has(id)) return
    this.#thumbs.set(id, null)
    void this.#loadThumbnail(id)
  }

  /** The cached thumbnail data URL for a snapshot, or null while it renders / when unavailable. */
  thumbnailUrl = (id: string): string | null => this.#thumbs.get(id) ?? null

  async #loadThumbnail(id: string): Promise<void> {
    // Disk cache first — thumbnails are rendered once and reused (FR-6).
    const cached = await this.#deps.port?.loadThumbnail(this.#key, id)
    if (cached) {
      this.#thumbs.set(id, toDataUrl(cached))
      return
    }
    const project = resolveSnapshot(this.#archive, id)
    if (!project) return
    const render = this.#deps.renderThumbnail ?? renderThumbnail
    const bytes = await render(project)
    if (!bytes) return // leave null → placeholder
    this.#thumbs.set(id, toDataUrl(bytes))
    await this.#deps.port?.saveThumbnail(this.#key, id, bytes)
  }

  async #takeAuto(): Promise<void> {
    const doc = this.#deps.getDoc()
    if (this.#serialize(doc) === this.#lastJson) {
      // Unchanged since the last snapshot — nothing to capture (Decision §2).
      this.#commands = 0
      this.#lastAt = this.#now()
      return
    }
    await this.#add(doc, 'auto')
  }

  async #add(doc: Project, kind: SnapshotKind, label?: string, note?: string): Promise<void> {
    this.#archive = addSnapshot(this.#archive, doc, {
      id: this.#newId(),
      createdAt: this.#now(),
      kind,
      ...(label !== undefined ? { label } : {}),
      ...(note !== undefined && note !== '' ? { note } : {}),
    })
    this.#archive = pruneArchive(this.#archive)
    this.#lastJson = this.#serialize(doc)
    this.#commands = 0
    this.#lastAt = this.#now()
    this.#refresh()
    await this.#persist()
  }

  #resetBaseline(): void {
    this.#commands = 0
    this.#lastAt = this.#now()
    this.#lastJson = this.#serialize(this.#deps.getDoc())
  }

  #refresh(): void {
    this.snapshots = [...listSnapshots(this.#archive)].reverse()
  }

  async #persist(): Promise<void> {
    await this.#deps.port?.saveArchive(this.#key, serializeArchive(this.#archive))
  }
}

function defaultId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined
  return c?.randomUUID?.() ?? `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function toDataUrl(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  const base64 = typeof btoa === 'function' ? btoa(binary) : ''
  return `data:image/png;base64,${base64}`
}
