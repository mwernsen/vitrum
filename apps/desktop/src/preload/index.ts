import { contextBridge, ipcRenderer } from 'electron'

/** Menu commands the main process forwards to the renderer. Mirror of ui's `MenuAction`. */
type MenuAction = 'new' | 'open' | 'save' | 'saveAs' | 'undo' | 'redo' | 'togglePalette'

interface OpenedFile {
  path: string
  contents: string
}

// The renderer runs with context isolation; everything it may touch from the host
// process is exposed explicitly here. The `storage`, `onMenuAction`, `reportDirty`,
// `confirmDiscard` and `confirmRecover` members together satisfy `@vitrum/ui`'s
// `AppHost`, so the renderer can pass `window.vitrum` straight in as its host (F-002).
const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  storage: {
    openFile: (): Promise<OpenedFile | null> => ipcRenderer.invoke('storage:open'),
    saveFile: (path: string, contents: string): Promise<void> =>
      ipcRenderer.invoke('storage:save', path, contents),
    saveFileAs: (suggestedName: string, contents: string): Promise<string | null> =>
      ipcRenderer.invoke('storage:saveAs', suggestedName, contents),
    writeAutosave: (contents: string): Promise<void> =>
      ipcRenderer.invoke('autosave:write', contents),
    readAutosave: (): Promise<string | null> => ipcRenderer.invoke('autosave:read'),
    clearAutosave: (): Promise<void> => ipcRenderer.invoke('autosave:clear'),
  },
  onMenuAction: (handler: (action: MenuAction) => void): (() => void) => {
    const listener = (_event: unknown, action: MenuAction): void => handler(action)
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  },
  reportDirty: (dirty: boolean): void => ipcRenderer.send('doc:dirty', dirty),
  confirmDiscard: (): Promise<boolean> => ipcRenderer.invoke('confirm:discard'),
  confirmRecover: (): Promise<boolean> => ipcRenderer.invoke('confirm:recover'),
} as const

contextBridge.exposeInMainWorld('vitrum', api)

export type VitrumApi = typeof api
