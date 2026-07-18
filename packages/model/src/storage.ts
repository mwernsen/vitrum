/**
 * The storage port (F-002). File dialogs and disk access are host concerns: on the
 * desktop they run in the Electron main process; in a plain browser (`pnpm dev:ui`) they
 * are stubbed. Keeping them behind this interface is what lets `packages/model` and
 * `packages/ui` stay free of Electron and still be exercised in a browser.
 */

/** A file the user opened: its path (for silent save-in-place) and text contents. */
export interface OpenedFile {
  readonly path: string
  readonly contents: string
}

export interface StoragePort {
  /** Show the open dialog and read the chosen file. Resolves to null if cancelled. */
  openFile(): Promise<OpenedFile | null>

  /** Write to an already-known path — the silent Cmd-S save-in-place path. */
  saveFile(path: string, contents: string): Promise<void>

  /**
   * Show the save dialog (for a new document or Save-As) and write. Resolves to the
   * chosen path, or null if cancelled. `suggestedName` seeds the dialog's filename.
   */
  saveFileAs(suggestedName: string, contents: string): Promise<string | null>

  /** Write the crash-recovery snapshot to the app-data directory. */
  writeAutosave(contents: string): Promise<void>

  /** Read the crash-recovery snapshot, or null if none exists. */
  readAutosave(): Promise<string | null>

  /** Remove the crash-recovery snapshot (after a clean save or clean exit). */
  clearAutosave(): Promise<void>
}
