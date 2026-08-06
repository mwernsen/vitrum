import type {
  GlassLibraryPort,
  LibraryPort,
  OpenedFile,
  PriceBookPort,
  StoragePort,
  VersionPort,
} from '@vitrum/model'

import type { AppHost, ExportPort, ImportPort, MenuAction, OpenedImage } from './host'

/** An in-memory `AppHost` for tests: records I/O and answers prompts deterministically. */
export interface FakeHost extends AppHost {
  readonly files: Map<string, Uint8Array>
  autosave: Uint8Array | null
  dirty: boolean
  nextOpen: OpenedFile | null
  nextSaveAsPath: string | null
  discardAnswer: boolean
  recoverAnswer: boolean
  /** Persisted global glass library JSON (null = first run). */
  glassLibraryStore: string | null
  /** Persisted global price book JSON (null = first run). */
  priceBookStore: string | null
  /** The JSON returned by the next `importLibrary()` call. */
  nextImportLibrary: string | null
  /** The most recent library JSON handed to `exportLibrary()`. */
  lastExportedLibrary: string | null
  /** The most recent PDF bytes handed to `export.savePdf()`, and its suggested name. */
  lastExportedPdf: { name: string; bytes: Uint8Array } | null
  /** The most recent text handed to `export.saveText()`, and its suggested name (F-042 CSV, F-043 SVG/DXF). */
  lastExportedText: { name: string; text: string } | null
  /** The most recent PNG bytes handed to `export.savePng()`, and its suggested name (F-043). */
  lastExportedPng: { name: string; bytes: Uint8Array } | null
  /** The file returned by the next `import.openSvg()` call (F-050). */
  nextImportSvg: OpenedFile | null
  /** The image returned by the next `import.openImage()` call (F-051). */
  nextImportImage: OpenedImage | null
  /** Persisted version archives, keyed by document key (F-055). */
  readonly versionArchives: Map<string, Uint8Array>
  /** Persisted version thumbnails, keyed by `key/id` (F-055). */
  readonly versionThumbnails: Map<string, Uint8Array>
  /** Persisted panel-library JSON (null = first run) (F-058). */
  panelLibraryStore: string | null
  /** Persisted panel thumbnails, keyed by {@link panelThumbnailKey} (F-058). */
  readonly panelThumbnails: Map<string, Uint8Array>
  /** Modification times the library's `stat` reports; a path absent here reads as missing (F-058). */
  readonly mtimes: Map<string, number>
  emitMenu(action: MenuAction): void
  /** Deliver an `open-file` event, as the OS does for a double-click while running (F-058). */
  emitOpenFile(path: string): void
}

export function createFakeHost(): FakeHost {
  const files = new Map<string, Uint8Array>()
  const versionArchives = new Map<string, Uint8Array>()
  const versionThumbnails = new Map<string, Uint8Array>()
  const panelThumbnails = new Map<string, Uint8Array>()
  const mtimes = new Map<string, number>()
  let menuHandler: ((action: MenuAction) => void) | undefined
  let openFileHandler: ((path: string) => void) | undefined

  const host: FakeHost = {
    files,
    versionArchives,
    versionThumbnails,
    panelThumbnails,
    mtimes,
    panelLibraryStore: null,
    autosave: null,
    dirty: false,
    nextOpen: null,
    nextSaveAsPath: '/tmp/design.vitrum',
    discardAnswer: true,
    recoverAnswer: false,
    glassLibraryStore: null,
    priceBookStore: null,
    nextImportLibrary: null,
    lastExportedLibrary: null,
    lastExportedPdf: null,
    lastExportedText: null,
    lastExportedPng: null,
    nextImportSvg: null,
    nextImportImage: null,
    storage: {
      openFile: async () => host.nextOpen,
      readFile: async (path) => {
        const contents = files.get(path)
        return contents ? { path, contents } : null
      },
      saveFile: async (path, contents) => {
        files.set(path, contents)
        mtimes.set(path, mtimes.size + 1)
      },
      saveFileAs: async (_name, contents) => {
        if (host.nextSaveAsPath) {
          files.set(host.nextSaveAsPath, contents)
          mtimes.set(host.nextSaveAsPath, mtimes.size + 1)
        }
        return host.nextSaveAsPath
      },
      writeAutosave: async (contents) => {
        host.autosave = contents
      },
      readAutosave: async () => host.autosave,
      clearAutosave: async () => {
        host.autosave = null
      },
    } satisfies StoragePort,
    glassLibrary: {
      load: async () => host.glassLibraryStore,
      save: async (contents) => {
        host.glassLibraryStore = contents
      },
      exportLibrary: async (name, contents) => {
        host.lastExportedLibrary = contents
        return name
      },
      importLibrary: async () => host.nextImportLibrary,
    } satisfies GlassLibraryPort,
    priceBook: {
      load: async () => host.priceBookStore,
      save: async (contents) => {
        host.priceBookStore = contents
      },
    } satisfies PriceBookPort,
    export: {
      savePdf: async (name, bytes) => {
        host.lastExportedPdf = { name, bytes }
        return name
      },
      saveText: async (name, text) => {
        host.lastExportedText = { name, text }
        return name
      },
      savePng: async (name, bytes) => {
        host.lastExportedPng = { name, bytes }
        return name
      },
    } satisfies ExportPort,
    import: {
      openSvg: async () => host.nextImportSvg,
      openImage: async () => host.nextImportImage,
    } satisfies ImportPort,
    versionStore: {
      loadArchive: async (key) => versionArchives.get(key) ?? null,
      saveArchive: async (key, bytes) => {
        versionArchives.set(key, bytes)
      },
      loadThumbnail: async (key, id) => versionThumbnails.get(`${key}/${id}`) ?? null,
      saveThumbnail: async (key, id, bytes) => {
        versionThumbnails.set(`${key}/${id}`, bytes)
      },
    } satisfies VersionPort,
    library: {
      load: async () => host.panelLibraryStore,
      save: async (contents) => {
        host.panelLibraryStore = contents
      },
      stat: async (paths) => paths.map((path) => mtimes.get(path) ?? null),
      loadThumbnail: async (key) => panelThumbnails.get(key) ?? null,
      saveThumbnail: async (key, bytes) => {
        panelThumbnails.set(key, bytes)
      },
    } satisfies LibraryPort,
    onOpenFile: (handler) => {
      openFileHandler = handler
      return () => {
        openFileHandler = undefined
      }
    },
    emitOpenFile: (path) => openFileHandler?.(path),
    onMenuAction: (handler) => {
      menuHandler = handler
      return () => {
        menuHandler = undefined
      }
    },
    reportDirty: (value) => {
      host.dirty = value
    },
    confirmDiscard: () => host.discardAnswer,
    confirmRecover: () => host.recoverAnswer,
    emitMenu: (action) => menuHandler?.(action),
  }

  return host
}
