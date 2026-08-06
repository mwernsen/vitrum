import {
  deserializePanelLibrary,
  emptyPanelLibrary,
  forgetPanel,
  panelEntryFor,
  panelThumbnailKey,
  recordPanelOpened,
  relocatePanel,
  serializePanelLibrary,
  unpackDocument,
  type LibraryPort,
  type PanelEntry,
  type PanelLibrary,
  type Project,
  type StoragePort,
} from '@vitrum/model'

import { SvelteMap } from 'svelte/reactivity'

import { renderThumbnail } from '../thumbnail'

/** One row of the launch screen's grid: the persisted entry plus what we learned from disk. */
export interface LibraryRow {
  readonly entry: PanelEntry
  /** True when the file is gone or unreadable — the missing state with locate / forget (FR-2). */
  readonly missing: boolean
}

/** What the controller needs from its environment, injected so it stays testable. */
export interface LibraryControllerDeps {
  /** Persistent recents store + thumbnail cache. Absent ⇒ the list is session-only. */
  port?: LibraryPort
  /** Reading a `.vitrum` file to render its thumbnail, and the locate dialog. */
  storage: Pick<StoragePort, 'openFile' | 'readFile'>
  /** Clock, injected for deterministic tests. */
  now?: () => number
  /** Render a document preview (PNG bytes), injected so the DOM stays out of tests. */
  renderThumbnail?: (project: Project) => Promise<Uint8Array | null>
}

/**
 * The reactive bridge to the panel library (F-058): the recents the launch screen lists, their
 * missing state, and their lazily rendered thumbnails. It mirrors the framework-free
 * {@link PanelLibrary} into runes and persists through a {@link LibraryPort} — the same app-level
 * split the glass library (F-022) and version history (F-055) use, so nothing here is part of the
 * document/undo model.
 *
 * The library is a *view over the user's files*: it stores paths and display metadata, never document
 * content, and a file that moved shows a missing state rather than being resurrected.
 */
export class LibraryController {
  readonly #deps: LibraryControllerDeps
  readonly #now: () => number

  #library: PanelLibrary = emptyPanelLibrary()

  /** The grid's rows, newest-opened first (FR-2). */
  rows = $state<LibraryRow[]>([])
  /** True once the persisted library has been read. */
  loaded = $state(false)
  /** A non-blocking message for the launch screen (e.g. a dropped file that was not a panel, FR-4). */
  error = $state<string | null>(null)

  /** Cache of thumbnail key → data URL (null = requested but unavailable → placeholder). */
  #thumbs = new SvelteMap<string, string | null>()
  /** Last known modification time per path, so a thumbnail key is stable between renders (FR-6). */
  #mtimes = new SvelteMap<string, number | null>()

  constructor(deps: LibraryControllerDeps) {
    this.#deps = deps
    this.#now = deps.now ?? Date.now
  }

  /**
   * Read the persisted library and check each file (FR-7). Every disk touch is guarded, so a missing
   * or slow store leaves an empty library instead of blocking startup.
   */
  init = async (): Promise<void> => {
    let contents: string | null
    try {
      contents = (await this.#deps.port?.load()) ?? null
    } catch {
      contents = null
    }
    this.#library = contents ? deserializePanelLibrary(contents) : emptyPanelLibrary()
    await this.refresh()
    this.loaded = true
  }

  /** Re-stat every entry, updating the missing state (and the thumbnail keys) from disk. */
  refresh = async (): Promise<void> => {
    const paths = this.#library.entries.map((e) => e.path)
    let stats: readonly (number | null)[] = paths.map(() => null)
    if (this.#deps.port && paths.length > 0) {
      try {
        stats = await this.#deps.port.stat(paths)
      } catch {
        // Leave every entry unstatted; they render as missing rather than breaking the screen.
      }
    }
    paths.forEach((path, i) => this.#mtimes.set(path, stats[i] ?? null))
    // With no port there is nothing to stat against, so entries are taken at face value.
    const trusting = !this.#deps.port
    this.rows = this.#library.entries.map((entry, i) => ({
      entry,
      missing: trusting ? false : stats[i] === null || stats[i] === undefined,
    }))
  }

  /**
   * Record that a panel was opened, or came back to the library after editing (FR-2/FR-5). Refreshes
   * the entry's metadata from the document and moves it to the front; the thumbnail follows the
   * file's new modification time, so a saved change shows up as a fresh preview.
   */
  recordOpened = async (path: string, project: Project): Promise<void> => {
    this.#library = recordPanelOpened(this.#library, panelEntryFor(path, project, this.#now()))
    await this.#persist()
    await this.refresh()
  }

  /** Drop an entry from the library. The file on disk is untouched. */
  forget = async (path: string): Promise<void> => {
    this.#library = forgetPanel(this.#library, path)
    await this.#persist()
    await this.refresh()
  }

  /**
   * "Locate…" a missing file: ask the host for its new home and rebind the entry to it (FR-2).
   * Resolves the new path, or null if the user cancelled.
   */
  locate = async (path: string): Promise<string | null> => {
    const file = await this.#deps.storage.openFile()
    if (!file) return null
    this.#library = relocatePanel(this.#library, path, file.path)
    await this.#persist()
    await this.refresh()
    return file.path
  }

  /**
   * Kick off a lazy thumbnail render for an entry if one is not already cached (FR-6). Safe to call
   * repeatedly; the first call per path+mtime triggers the cache → read → render → cache pipeline.
   * Call from an effect (it mutates reactive state), then read the result via {@link thumbnailUrl}.
   */
  requestThumbnail = (path: string): void => {
    const key = this.#keyFor(path)
    if (key === null || this.#thumbs.has(key)) return
    this.#thumbs.set(key, null)
    void this.#loadThumbnail(path, key)
  }

  /** The cached thumbnail data URL for an entry, or null while it renders / when unavailable. */
  thumbnailUrl = (path: string): string | null => {
    const key = this.#keyFor(path)
    return key === null ? null : (this.#thumbs.get(key) ?? null)
  }

  /** Show a non-blocking message on the launch screen (FR-4). */
  fail = (message: string): void => {
    this.error = message
  }

  clearError = (): void => {
    this.error = null
  }

  /** The thumbnail cache key for a path, or null while we do not know its modification time. */
  #keyFor(path: string): string | null {
    const mtime = this.#mtimes.get(path)
    return typeof mtime === 'number' ? panelThumbnailKey(path, mtime) : null
  }

  async #loadThumbnail(path: string, key: string): Promise<void> {
    // Cache first — a preview is rendered once per file revision and reused (FR-6).
    try {
      const cached = await this.#deps.port?.loadThumbnail(key)
      if (cached && cached.length > 0) {
        this.#thumbs.set(key, toDataUrl(cached))
        return
      }
    } catch {
      // Fall through to a fresh render.
    }
    const read = this.#deps.storage.readFile
    if (!read) return // leave null → placeholder
    let project: Project
    try {
      const file = await read(path)
      if (!file) return
      project = unpackDocument(file.contents).project
    } catch {
      return // unreadable or not a panel → placeholder, never an error (FR-6)
    }
    const render = this.#deps.renderThumbnail ?? renderThumbnail
    const bytes = await render(project)
    if (!bytes) return
    this.#thumbs.set(key, toDataUrl(bytes))
    try {
      await this.#deps.port?.saveThumbnail(key, bytes)
    } catch {
      // A failed cache write costs a re-render next time, nothing more.
    }
  }

  async #persist(): Promise<void> {
    try {
      await this.#deps.port?.save(serializePanelLibrary(this.#library))
    } catch {
      // The library is a convenience; failing to persist must never break the app.
    }
  }
}

function toDataUrl(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  const base64 = typeof btoa === 'function' ? btoa(binary) : ''
  return `data:image/png;base64,${base64}`
}
