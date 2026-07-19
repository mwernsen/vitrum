import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron'

const FILE_FILTERS = [{ name: 'Vitrum design', extensions: ['vitrum'] }]
const LIBRARY_FILTERS = [{ name: 'Glass library', extensions: ['json'] }]

/** Where the crash-recovery snapshot lives (overridable so E2E runs stay isolated). */
function autosavePath(): string {
  return process.env['VITRUM_AUTOSAVE_PATH'] ?? join(app.getPath('userData'), 'autosave.vitrum')
}

/** Where the global glass library is persisted (overridable so E2E runs stay isolated). */
function glassLibraryPath(): string {
  return (
    process.env['VITRUM_GLASS_LIBRARY_PATH'] ?? join(app.getPath('userData'), 'glass-library.json')
  )
}

// Unsaved-changes state, reported by the renderer, used to guard window close (F-002).
let documentDirty = false
let allowClose = false

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'Vitrum',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      // ESM preload scripts require an unsandboxed renderer; context isolation
      // stays on and is the actual security boundary here.
      sandbox: false,
    },
  })

  window.on('ready-to-show', () => window.show())

  // Guard against closing with unsaved work. The close event is synchronous, so we
  // cancel it, ask, and re-issue the close once the user confirms.
  window.on('close', (event) => {
    if (allowClose || !documentDirty) return
    event.preventDefault()
    void dialog
      .showMessageBox(window, {
        type: 'warning',
        buttons: ['Discard', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: 'Discard unsaved changes?',
        detail: 'Your document has changes that have not been saved.',
      })
      .then(({ response }) => {
        if (response === 0) {
          allowClose = true
          window.close()
        }
      })
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

/** Send a menu command to the focused window's renderer. */
function dispatch(action: string): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:action', action)
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  // Accelerators are shown in the menu but NOT registered here (`registerAccelerator:
  // false`): the renderer's keydown handler owns the shortcuts, so a keystroke fires
  // exactly once instead of once per layer.
  const fileItems: MenuItemConstructorOptions[] = [
    {
      label: 'New',
      accelerator: 'CmdOrCtrl+N',
      registerAccelerator: false,
      click: () => dispatch('new'),
    },
    {
      label: 'Open…',
      accelerator: 'CmdOrCtrl+O',
      registerAccelerator: false,
      click: () => dispatch('open'),
    },
    { type: 'separator' },
    {
      label: 'Save',
      accelerator: 'CmdOrCtrl+S',
      registerAccelerator: false,
      click: () => dispatch('save'),
    },
    {
      label: 'Save As…',
      accelerator: 'CmdOrCtrl+Shift+S',
      registerAccelerator: false,
      click: () => dispatch('saveAs'),
    },
    { type: 'separator' },
    isMac ? { role: 'close' } : { role: 'quit' },
  ]

  const editItems: MenuItemConstructorOptions[] = [
    {
      label: 'Undo',
      accelerator: 'CmdOrCtrl+Z',
      registerAccelerator: false,
      click: () => dispatch('undo'),
    },
    {
      label: 'Redo',
      accelerator: 'CmdOrCtrl+Shift+Z',
      registerAccelerator: false,
      click: () => dispatch('redo'),
    },
  ]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: fileItems },
    { label: 'Edit', submenu: editItems },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc(): void {
  ipcMain.handle('storage:open', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: FILE_FILTERS })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    return { path, contents: await readFile(path, 'utf8') }
  })

  ipcMain.handle('storage:save', async (_event, path: string, contents: string) => {
    await writeFile(path, contents, 'utf8')
  })

  ipcMain.handle('storage:saveAs', async (_event, suggestedName: string, contents: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: suggestedName,
      filters: FILE_FILTERS,
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, contents, 'utf8')
    return result.filePath
  })

  ipcMain.handle('autosave:write', async (_event, contents: string) => {
    await writeFile(autosavePath(), contents, 'utf8')
  })

  ipcMain.handle('autosave:read', async () => {
    try {
      return await readFile(autosavePath(), 'utf8')
    } catch {
      return null
    }
  })

  ipcMain.handle('autosave:clear', async () => {
    await rm(autosavePath(), { force: true })
  })

  ipcMain.handle('glassLib:load', async () => {
    try {
      return await readFile(glassLibraryPath(), 'utf8')
    } catch {
      return null
    }
  })

  ipcMain.handle('glassLib:save', async (_event, contents: string) => {
    await writeFile(glassLibraryPath(), contents, 'utf8')
  })

  ipcMain.handle('glassLib:export', async (_event, suggestedName: string, contents: string) => {
    const result = await dialog.showSaveDialog({
      defaultPath: suggestedName,
      filters: LIBRARY_FILTERS,
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, contents, 'utf8')
    return result.filePath
  })

  ipcMain.handle('glassLib:import', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: LIBRARY_FILTERS,
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    return readFile(path, 'utf8')
  })

  ipcMain.handle('confirm:discard', async () => {
    const window = BrowserWindow.getFocusedWindow() ?? undefined
    const { response } = await dialog.showMessageBox(window!, {
      type: 'warning',
      buttons: ['Discard', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Discard unsaved changes?',
    })
    return response === 0
  })

  ipcMain.handle('confirm:recover', async () => {
    const window = BrowserWindow.getFocusedWindow() ?? undefined
    const { response } = await dialog.showMessageBox(window!, {
      type: 'question',
      buttons: ['Recover', 'Discard'],
      defaultId: 0,
      cancelId: 1,
      message: 'Recover unsaved work?',
      detail: 'Vitrum found autosaved changes from a session that did not close cleanly.',
    })
    return response === 0
  })

  ipcMain.on('doc:dirty', (_event, dirty: boolean) => {
    documentDirty = Boolean(dirty)
  })
}

void app.whenReady().then(() => {
  registerIpc()
  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
