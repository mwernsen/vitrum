import type { GlassLibraryPort, OpenedFile, StoragePort, VersionPort } from '@vitrum/model'

import type { AppHost, ExportPort, ImportPort, OpenedImage } from './host'

/**
 * A browser stub of `AppHost` for `pnpm dev:ui`, where no Electron main process exists.
 * Files use download/upload instead of native dialogs, autosave uses `localStorage`, and
 * the unsaved-changes guard uses `beforeunload`. It is intentionally minimal — the real
 * desktop host lives in `apps/desktop`.
 */
const AUTOSAVE_KEY = 'vitrum:autosave'
const GLASS_LIBRARY_KEY = 'vitrum:glass-library'
const VERSIONS_PREFIX = 'vitrum:versions:'

/** A localStorage-safe key fragment for a document path (F-055). */
function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export function createBrowserHost(): AppHost {
  let dirty = false

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', (event) => {
      if (!dirty) return
      event.preventDefault()
      // Legacy field some browsers still require to trigger the prompt.
      event.returnValue = ''
    })
  }

  const storage: StoragePort = {
    openFile: () => pickFileBytes('.vitrum,application/zip'),
    saveFile: async (_path, contents) => {
      downloadBytes('design.vitrum', contents, 'application/octet-stream')
    },
    saveFileAs: async (suggestedName, contents) => {
      downloadBytes(suggestedName, contents, 'application/octet-stream')
      return suggestedName
    },
    // localStorage holds strings only, so the binary zip snapshot is base64-encoded here (this is a
    // dev stub; the desktop host writes real bytes to disk).
    writeAutosave: async (contents) => {
      safeLocalStorage()?.setItem(AUTOSAVE_KEY, bytesToBase64(contents))
    },
    readAutosave: async () => {
      const stored = safeLocalStorage()?.getItem(AUTOSAVE_KEY)
      return stored ? base64ToBytes(stored) : null
    },
    clearAutosave: async () => {
      safeLocalStorage()?.removeItem(AUTOSAVE_KEY)
    },
  }

  const glassLibrary: GlassLibraryPort = {
    load: async () => safeLocalStorage()?.getItem(GLASS_LIBRARY_KEY) ?? null,
    save: async (contents) => {
      safeLocalStorage()?.setItem(GLASS_LIBRARY_KEY, contents)
    },
    exportLibrary: async (suggestedName, contents) => {
      downloadText(suggestedName, contents)
      return suggestedName
    },
    importLibrary: () => pickFileText('.json,application/json'),
  }

  const exportPort: ExportPort = {
    savePdf: async (suggestedName, bytes) => {
      downloadBytes(suggestedName, bytes)
      return suggestedName
    },
    saveText: async (suggestedName, text) => {
      downloadText(suggestedName, text)
      return suggestedName
    },
    savePng: async (suggestedName, bytes) => {
      downloadBytes(suggestedName, bytes, 'image/png')
      return suggestedName
    },
  }

  const importPort: ImportPort = {
    openSvg: () => pickFileBytes('.svg,image/svg+xml'),
    openImage: () => pickImage(),
  }

  // Version history (F-055). localStorage holds strings only, so binary archives/thumbnails are
  // base64-encoded here (this is a dev stub; the desktop host writes real bytes to disk).
  const versions: VersionPort = {
    loadArchive: async (key) => {
      const stored = safeLocalStorage()?.getItem(`${VERSIONS_PREFIX}${safeKey(key)}:archive`)
      return stored ? base64ToBytes(stored) : null
    },
    saveArchive: async (key, bytes) => {
      safeLocalStorage()?.setItem(`${VERSIONS_PREFIX}${safeKey(key)}:archive`, bytesToBase64(bytes))
    },
    loadThumbnail: async (key, id) => {
      const stored = safeLocalStorage()?.getItem(
        `${VERSIONS_PREFIX}${safeKey(key)}:thumb:${safeKey(id)}`,
      )
      return stored ? base64ToBytes(stored) : null
    },
    saveThumbnail: async (key, id, bytes) => {
      safeLocalStorage()?.setItem(
        `${VERSIONS_PREFIX}${safeKey(key)}:thumb:${safeKey(id)}`,
        bytesToBase64(bytes),
      )
    },
  }

  return {
    storage,
    glassLibrary,
    export: exportPort,
    import: importPort,
    versionStore: versions,
    reportDirty: (value) => {
      dirty = value
    },
    confirmDiscard: () =>
      typeof window === 'undefined' ? true : window.confirm('Discard unsaved changes?'),
    confirmRecover: () =>
      typeof window === 'undefined'
        ? false
        : window.confirm('Recover unsaved work from your previous session?'),
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function downloadText(name: string, text: string): void {
  if (typeof document === 'undefined') return
  triggerDownload(name, new Blob([text], { type: 'text/csv;charset=utf-8' }))
}

function downloadBytes(name: string, bytes: Uint8Array, mime = 'application/pdf'): void {
  if (typeof document === 'undefined') return
  // Copy into a fresh ArrayBuffer so the Blob gets a plain BlobPart (not a SharedArrayBuffer view).
  const buffer = bytes.slice().buffer
  triggerDownload(name, new Blob([buffer], { type: mime }))
}

function triggerDownload(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function chooseFile(accept: string): Promise<File | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.click()
  })
}

async function pickFileBytes(accept: string): Promise<OpenedFile | null> {
  const file = await chooseFile(accept)
  if (!file) return null
  const buffer = await file.arrayBuffer()
  return { path: file.name, contents: new Uint8Array(buffer) }
}

async function pickFileText(accept: string): Promise<string | null> {
  const file = await chooseFile(accept)
  return file ? file.text() : null
}

async function pickImage(): Promise<OpenedImage | null> {
  const file = await chooseFile('image/png,image/jpeg,image/webp')
  if (!file) return null
  const buffer = await file.arrayBuffer()
  return { path: file.name, mime: file.type || 'image/png', bytes: new Uint8Array(buffer) }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return typeof btoa === 'function' ? btoa(binary) : ''
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof atob !== 'function') return new Uint8Array()
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
