import { contextBridge } from 'electron'

// The renderer runs with context isolation; everything it may touch from the
// host process is exposed explicitly here.
const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
} as const

contextBridge.exposeInMainWorld('vitrum', api)

export type VitrumApi = typeof api
