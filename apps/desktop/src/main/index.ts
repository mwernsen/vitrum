import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
  type MenuItemConstructorOptions,
} from 'electron'

const FILE_FILTERS = [{ name: 'Vitrum design', extensions: ['vitrum'] }]

/** Resolve a path inside the bundled resources folder (works in dev and packaged). */
function resourcePath(...segments: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : join(import.meta.dirname, '../../resources')
  return join(base, ...segments)
}
const LIBRARY_FILTERS = [{ name: 'Glass library', extensions: ['json'] }]
const PDF_FILTERS = [{ name: 'PDF document', extensions: ['pdf'] }]
const CSV_FILTERS = [{ name: 'CSV spreadsheet', extensions: ['csv'] }]
const SVG_FILTERS = [{ name: 'SVG image', extensions: ['svg'] }]
const DXF_FILTERS = [{ name: 'DXF drawing', extensions: ['dxf'] }]
const PNG_FILTERS = [{ name: 'PNG image', extensions: ['png'] }]
const IMAGE_FILTERS = [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]

/** Best-effort MIME from a reference-image file's extension (F-051). */
function mimeForImage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return 'image/png'
}

/** Choose the save-dialog filter for a text export from the suggested file extension (F-042/F-043). */
function textFiltersFor(suggestedName: string): { name: string; extensions: string[] }[] {
  const ext = suggestedName.split('.').pop()?.toLowerCase()
  if (ext === 'svg') return SVG_FILTERS
  if (ext === 'dxf') return DXF_FILTERS
  return CSV_FILTERS
}

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

/** Base directory for version history (F-055), overridable so E2E runs stay isolated. */
function versionsBaseDir(): string {
  return process.env['VITRUM_VERSIONS_PATH'] ?? join(app.getPath('userData'), 'versions')
}

/** A filesystem-safe folder name for a per-document version key (its file path). */
function versionKeyDir(key: string): string {
  return join(versionsBaseDir(), key.replace(/[^a-zA-Z0-9._-]/g, '_') || 'scratch')
}

/** Where the global workshop price book is persisted (overridable so E2E runs stay isolated). */
function priceBookPath(): string {
  return process.env['VITRUM_PRICE_BOOK_PATH'] ?? join(app.getPath('userData'), 'price-book.json')
}

/** Base directory for the panel library (F-058), overridable so E2E runs stay isolated. */
function libraryBaseDir(): string {
  return process.env['VITRUM_LIBRARY_PATH'] ?? join(app.getPath('userData'), 'library')
}

/** The recents store. Paths + display metadata only — never document content. */
function libraryPath(): string {
  return join(libraryBaseDir(), 'panels.json')
}

/** Cached panel previews, keyed by the renderer's path + mtime key (FR-6). */
function libraryThumbPath(key: string): string {
  return join(libraryBaseDir(), 'thumbs', `${key.replace(/[^a-zA-Z0-9._-]/g, '_')}.png`)
}

/**
 * A `.vitrum` file the app was launched with (F-058 FR-1): a `open-file` event on macOS, or a
 * command-line argument on Windows/Linux. Consumed once by the renderer at startup; later events
 * are forwarded straight to the open window.
 */
let pendingOpenPath: string | null = null

/** Pull a `.vitrum` path out of a process argv, ignoring Electron's own flags and the app path. */
function panelPathFromArgv(argv: readonly string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-') || arg === '.') continue
    if (arg.toLowerCase().endsWith('.vitrum')) return arg
  }
  return null
}

/** Route a file the OS asked us to open: to the live window, or held for the renderer's first ask. */
function routeOpenFile(path: string): void {
  const window = BrowserWindow.getAllWindows()[0]
  if (window && !window.webContents.isLoading()) window.webContents.send('app:openFile', path)
  else pendingOpenPath = path
}

// macOS delivers double-clicked files here, and does so before `whenReady` on a cold launch.
app.on('open-file', (event, path) => {
  event.preventDefault()
  routeOpenFile(path)
})

// Unsaved-changes state, reported by the renderer, used to guard window close (F-002).
let documentDirty = false
let allowClose = false

function createWindow(): BrowserWindow {
  const icon = nativeImage.createFromPath(resourcePath('icon.png'))

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'Vitrum',
    icon,
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
  // Project files are the `.vitrum` zip container (F-051): read and write raw bytes, not UTF-8.
  ipcMain.handle('storage:open', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: FILE_FILTERS })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    return { path, contents: new Uint8Array(await readFile(path)) }
  })

  ipcMain.handle('storage:save', async (_event, path: string, contents: Uint8Array) => {
    await writeFile(path, Buffer.from(contents))
  })

  // Read an already-known path with no dialog (F-058): a library entry, a launch argument, a drop.
  // A missing or unreadable file resolves null so a stale entry degrades to its missing state.
  ipcMain.handle('storage:read', async (_event, path: string) => {
    try {
      return { path, contents: new Uint8Array(await readFile(path)) }
    } catch {
      return null
    }
  })

  // The panel library (F-058). Recents JSON + cached previews under a folder in the app-data
  // directory (`VITRUM_LIBRARY_PATH` isolates E2E runs).
  ipcMain.handle('library:load', async () => {
    try {
      return await readFile(libraryPath(), 'utf8')
    } catch {
      return null
    }
  })

  ipcMain.handle('library:save', async (_event, contents: string) => {
    await mkdir(libraryBaseDir(), { recursive: true })
    await writeFile(libraryPath(), contents, 'utf8')
  })

  // Modification time per path, or null where the file is gone — the grid's missing state (FR-2) and
  // the thumbnail cache key (FR-6). Never rejects, so a slow or absent disk cannot block the library.
  ipcMain.handle('library:stat', async (_event, paths: string[]) =>
    Promise.all(
      paths.map(async (path) => {
        try {
          const info = await stat(path)
          return info.isFile() ? info.mtimeMs : null
        } catch {
          return null
        }
      }),
    ),
  )

  ipcMain.handle('library:loadThumbnail', async (_event, key: string) => {
    try {
      return new Uint8Array(await readFile(libraryThumbPath(key)))
    } catch {
      return null
    }
  })

  ipcMain.handle('library:saveThumbnail', async (_event, key: string, bytes: Uint8Array) => {
    await mkdir(join(libraryBaseDir(), 'thumbs'), { recursive: true })
    await writeFile(libraryThumbPath(key), Buffer.from(bytes))
  })

  // The file the app was launched with, asked for once by the renderer at startup (FR-1).
  // `VITRUM_INITIAL_FILE` lets an E2E run assert the bypass without a real double-click.
  ipcMain.handle('app:initialFile', async () => {
    const path =
      pendingOpenPath ?? process.env['VITRUM_INITIAL_FILE'] ?? panelPathFromArgv(process.argv)
    pendingOpenPath = null
    return path ?? null
  })

  // Read an SVG file to import (F-050). `VITRUM_IMPORT_SVG_PATH` bypasses the native dialog so E2E
  // runs read a fixture they control instead of prompting. Bytes (the import feature decodes UTF-8).
  ipcMain.handle('import:openSvg', async () => {
    const forced = process.env['VITRUM_IMPORT_SVG_PATH']
    if (forced) return { path: forced, contents: new Uint8Array(await readFile(forced)) }
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: SVG_FILTERS })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    return { path, contents: new Uint8Array(await readFile(path)) }
  })

  // Read a raster image to import as a reference underlay (F-051). `VITRUM_IMPORT_IMAGE_PATH`
  // bypasses the dialog for E2E.
  ipcMain.handle('import:openImage', async () => {
    const forced = process.env['VITRUM_IMPORT_IMAGE_PATH']
    if (forced) {
      return {
        path: forced,
        mime: mimeForImage(forced),
        bytes: new Uint8Array(await readFile(forced)),
      }
    }
    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: IMAGE_FILTERS })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    return { path, mime: mimeForImage(path), bytes: new Uint8Array(await readFile(path)) }
  })

  // `VITRUM_SAVE_AS_PATH` bypasses the native save dialog so an E2E run can save a panel to a temp
  // file it controls — the same override idiom the export handlers use.
  ipcMain.handle('storage:saveAs', async (_event, suggestedName: string, contents: Uint8Array) => {
    const forced = process.env['VITRUM_SAVE_AS_PATH']
    if (forced) {
      await writeFile(forced, Buffer.from(contents))
      return forced
    }
    const result = await dialog.showSaveDialog({
      defaultPath: suggestedName,
      filters: FILE_FILTERS,
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, Buffer.from(contents))
    return result.filePath
  })

  ipcMain.handle('autosave:write', async (_event, contents: Uint8Array) => {
    await writeFile(autosavePath(), Buffer.from(contents))
  })

  ipcMain.handle('autosave:read', async () => {
    try {
      return new Uint8Array(await readFile(autosavePath()))
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

  ipcMain.handle('priceBook:load', async () => {
    try {
      return await readFile(priceBookPath(), 'utf8')
    } catch {
      return null
    }
  })

  ipcMain.handle('priceBook:save', async (_event, contents: string) => {
    await writeFile(priceBookPath(), contents, 'utf8')
  })

  // Write a generated PDF (F-041). `VITRUM_EXPORT_PATH` bypasses the native dialog so E2E runs write
  // to a temp file they can then read and assert on.
  ipcMain.handle('export:savePdf', async (_event, suggestedName: string, bytes: Uint8Array) => {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const forced = process.env['VITRUM_EXPORT_PATH']
    if (forced) {
      await writeFile(forced, buffer)
      return forced
    }
    const result = await dialog.showSaveDialog({ defaultPath: suggestedName, filters: PDF_FILTERS })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, buffer)
    return result.filePath
  })

  // Write a generated text document (F-042 CSV, F-043 SVG/DXF). `VITRUM_EXPORT_TEXT_PATH` bypasses
  // the dialog for E2E; otherwise the dialog filter is picked from the suggested extension.
  ipcMain.handle('export:saveText', async (_event, suggestedName: string, text: string) => {
    const forced = process.env['VITRUM_EXPORT_TEXT_PATH']
    if (forced) {
      await writeFile(forced, text, 'utf8')
      return forced
    }
    const result = await dialog.showSaveDialog({
      defaultPath: suggestedName,
      filters: textFiltersFor(suggestedName),
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, text, 'utf8')
    return result.filePath
  })

  // Write a generated PNG snapshot (F-043). `VITRUM_EXPORT_PNG_PATH` bypasses the dialog for E2E.
  ipcMain.handle('export:savePng', async (_event, suggestedName: string, bytes: Uint8Array) => {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const forced = process.env['VITRUM_EXPORT_PNG_PATH']
    if (forced) {
      await writeFile(forced, buffer)
      return forced
    }
    const result = await dialog.showSaveDialog({ defaultPath: suggestedName, filters: PNG_FILTERS })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, buffer)
    return result.filePath
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

  // Version history (F-055). Archives and thumbnails live under a per-document folder in the
  // app-data directory (`VITRUM_VERSIONS_PATH` isolates E2E runs). Binary bytes, not text.
  ipcMain.handle('versions:loadArchive', async (_event, key: string) => {
    try {
      return new Uint8Array(await readFile(join(versionKeyDir(key), 'archive.zip')))
    } catch {
      return null
    }
  })

  ipcMain.handle('versions:saveArchive', async (_event, key: string, bytes: Uint8Array) => {
    const dir = versionKeyDir(key)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'archive.zip'), Buffer.from(bytes))
  })

  ipcMain.handle('versions:loadThumbnail', async (_event, key: string, id: string) => {
    const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '_')
    try {
      return new Uint8Array(await readFile(join(versionKeyDir(key), 'thumbs', `${safeId}.png`)))
    } catch {
      return null
    }
  })

  ipcMain.handle(
    'versions:saveThumbnail',
    async (_event, key: string, id: string, bytes: Uint8Array) => {
      const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '_')
      const dir = join(versionKeyDir(key), 'thumbs')
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${safeId}.png`), Buffer.from(bytes))
    },
  )
}

function createTray(): Tray {
  const icon = nativeImage
    .createFromPath(resourcePath('tray-icon.png'))
    .resize({ width: 16, height: 16 })
  // On macOS, template images are automatically inverted for dark menu bars.
  icon.setTemplateImage(process.platform === 'darwin')
  const tray = new Tray(icon)
  tray.setToolTip('Vitrum')
  return tray
}

void app.whenReady().then(() => {
  registerIpc()
  buildMenu()
  createWindow()
  createTray()

  // Set the dock icon on macOS (higher-res than the BrowserWindow icon).
  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(resourcePath('icon.png')))
  }

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
