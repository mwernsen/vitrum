import type { GlassLibraryPort, OpenedFile, StoragePort } from '@vitrum/model'

import type { AppHost, MenuAction } from './host'

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
