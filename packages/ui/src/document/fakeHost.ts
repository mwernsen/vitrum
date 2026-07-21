import type { GlassLibraryPort, OpenedFile, StoragePort } from '@vitrum/model'

import type { AppHost, ExportPort, MenuAction } from './host'

/** An in-memory `AppHost` for tests: records I/O and answers prompts deterministically. */
export interface FakeHost extends AppHost {
  readonly files: Map<string, string>
  autosave: string | null
  dirty: boolean
  nextOpen: OpenedFile | null
  nextSaveAsPath: string | null
  discardAnswer: boolean
  recoverAnswer: boolean
  /** Persisted global glass library JSON (null = first run). */
  glassLibraryStore: string | null
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
  emitMenu(action: MenuAction): void
}

export function createFakeHost(): FakeHost {
  const files = new Map<string, string>()
  let menuHandler: ((action: MenuAction) => void) | undefined

  const host: FakeHost = {
    files,
    autosave: null,
    dirty: false,
    nextOpen: null,
    nextSaveAsPath: '/tmp/design.vitrum',
    discardAnswer: true,
    recoverAnswer: false,
    glassLibraryStore: null,
    nextImportLibrary: null,
    lastExportedLibrary: null,
    lastExportedPdf: null,
    lastExportedText: null,
    lastExportedPng: null,
    storage: {
      openFile: async () => host.nextOpen,
      saveFile: async (path, contents) => {
        files.set(path, contents)
      },
      saveFileAs: async (_name, contents) => {
        if (host.nextSaveAsPath) files.set(host.nextSaveAsPath, contents)
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
