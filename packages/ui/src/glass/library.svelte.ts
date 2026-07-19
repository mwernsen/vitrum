import {
  createStarterLibrary,
  deserializeLibrary,
  duplicateGlassInLibrary,
  libraryGlasses,
  mergeLibrary,
  newGlassId,
  removeGlassFromLibrary,
  serializeLibrary,
  upsertGlassInLibrary,
  type Glass,
  type GlassId,
  type GlassLibrary,
  type GlassLibraryPort,
} from '@vitrum/model'

/**
 * The reactive bridge to the global glass library (F-022). It mirrors the framework-free
 * {@link GlassLibrary} value into Svelte runes, owns the user operations (create / edit /
 * duplicate / delete / import / export), and persists every change through a {@link GlassLibraryPort}
 * (the Electron `userData` file on the desktop, `localStorage` in the browser, in-memory in tests).
 *
 * The library is app-level state, not part of the document/undo model — projects consume glasses
 * from it *by value* through document commands elsewhere. On first run it seeds from a fresh copy of
 * the shipped starter catalog (copy-on-write, FR-2); the shipped data is never mutated.
 */
export class GlassLibraryController {
  readonly #port: GlassLibraryPort | undefined

  library = $state<GlassLibrary>(createStarterLibrary())
  /** True once the persisted library has been loaded (or seeded) from the port. */
  loaded = $state(false)

  glasses = $derived<Glass[]>(libraryGlasses(this.library))

  constructor(port?: GlassLibraryPort) {
    this.#port = port
  }

  /**
   * Load the persisted library, or seed and persist the starter catalog on first run (FR-2). Safe to
   * call once on mount; without a port the in-memory starter library is used for the session.
   */
  init = async (): Promise<void> => {
    if (!this.#port) {
      this.loaded = true
      return
    }
    const raw = await this.#port.load()
    if (raw) {
      try {
        this.library = deserializeLibrary(raw)
      } catch {
        // A corrupt or too-new library file falls back to the starter catalog rather than crashing.
        this.library = createStarterLibrary()
      }
    } else {
      this.library = createStarterLibrary()
      await this.#persist()
    }
    this.loaded = true
  }

  /** Add or replace a glass in the library, then persist. */
  upsert = async (glass: Glass): Promise<void> => {
    this.library = upsertGlassInLibrary(this.library, glass)
    await this.#persist()
  }

  /** Remove a glass from the library, then persist. */
  remove = async (id: GlassId): Promise<void> => {
    this.library = removeGlassFromLibrary(this.library, id)
    await this.#persist()
  }

  /** Duplicate a glass under a fresh id; returns the created glass (or null if absent). */
  duplicate = async (id: GlassId): Promise<Glass | null> => {
    const result = duplicateGlassInLibrary(this.library, id, newGlassId())
    if (!result) return null
    this.library = result.library
    await this.#persist()
    return result.glass
  }

  /** Mint a fresh glass id for a new library entry. */
  newId = (): GlassId => newGlassId()

  /** Export the whole library to a user-chosen JSON file (FR-4). */
  exportLibrary = async (): Promise<void> => {
    await this.#port?.exportLibrary('glass-library.json', serializeLibrary(this.library))
  }

  /**
   * Import a library JSON file and merge it into the current one (incoming wins by id, FR-4), then
   * persist. Returns the number of glasses imported, or null if cancelled / no port.
   */
  importLibrary = async (): Promise<number | null> => {
    const raw = await this.#port?.importLibrary()
    if (!raw) return null
    const incoming = deserializeLibrary(raw)
    this.library = mergeLibrary(this.library, incoming)
    await this.#persist()
    return libraryGlasses(incoming).length
  }

  async #persist(): Promise<void> {
    await this.#port?.save(serializeLibrary(this.library))
  }
}
