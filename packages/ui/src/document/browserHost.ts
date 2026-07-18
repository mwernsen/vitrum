import type { OpenedFile, StoragePort } from '@vitrum/model'

import type { AppHost } from './host'

/**
 * A browser stub of `AppHost` for `pnpm dev:ui`, where no Electron main process exists.
 * Files use download/upload instead of native dialogs, autosave uses `localStorage`, and
 * the unsaved-changes guard uses `beforeunload`. It is intentionally minimal — the real
 * desktop host lives in `apps/desktop`.
 */
const AUTOSAVE_KEY = 'vitrum:autosave'

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
    openFile: () => pickFile(),
    saveFile: async (_path, contents) => {
      downloadFile('design.vitrum', contents)
    },
    saveFileAs: async (suggestedName, contents) => {
      downloadFile(suggestedName, contents)
      return suggestedName
    },
    writeAutosave: async (contents) => {
      safeLocalStorage()?.setItem(AUTOSAVE_KEY, contents)
    },
    readAutosave: async () => safeLocalStorage()?.getItem(AUTOSAVE_KEY) ?? null,
    clearAutosave: async () => {
      safeLocalStorage()?.removeItem(AUTOSAVE_KEY)
    },
  }

  return {
    storage,
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

function downloadFile(name: string, contents: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([contents], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function pickFile(): Promise<OpenedFile | null> {
  if (typeof document === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.vitrum,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      void file.text().then((contents) => resolve({ path: file.name, contents }))
    }
    input.click()
  })
}
