import type { StoragePort } from '@vitrum/model'

/**
 * How the UI reaches its host environment (F-002). The desktop app supplies an
 * Electron-backed host (native dialogs, app-data autosave, a native menu); `pnpm dev:ui`
 * and tests supply a browser/fake host. Keeping the surface behind `AppHost` is what lets
 * `packages/ui` stay Electron-free while still driving real files on the desktop.
 */

/** Menu commands the host can forward to the document controller. */
export type MenuAction = 'new' | 'open' | 'save' | 'saveAs' | 'undo' | 'redo' | 'togglePalette'

export interface AppHost {
  /** File dialogs, disk I/O and crash-recovery snapshots. */
  readonly storage: StoragePort
  /** Subscribe to native-menu commands. Returns an unsubscribe function. */
  onMenuAction?(handler: (action: MenuAction) => void): () => void
  /** Report unsaved-changes state so the host can guard window close. */
  reportDirty?(dirty: boolean): void
  /** Ask the user to confirm discarding unsaved changes. Defaults to "yes" when absent. */
  confirmDiscard?(): boolean | Promise<boolean>
  /**
   * Ask whether to restore a crash-recovery snapshot found at startup. Absent means the
   * host does not offer recovery (the snapshot is discarded).
   */
  confirmRecover?(): boolean | Promise<boolean>
}
