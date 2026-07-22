import type { GlassLibraryPort, OpenedFile, StoragePort, VersionPort } from '@vitrum/model'

/**
 * How the UI reaches its host environment (F-002). The desktop app supplies an
 * Electron-backed host (native dialogs, app-data autosave, a native menu); `pnpm dev:ui`
 * and tests supply a browser/fake host. Keeping the surface behind `AppHost` is what lets
 * `packages/ui` stay Electron-free while still driving real files on the desktop.
 */

/** Menu commands the host can forward to the document controller. */
export type MenuAction = 'new' | 'open' | 'save' | 'saveAs' | 'undo' | 'redo' | 'togglePalette'

/**
 * Writing generated documents (PDF today) to disk (F-041). Mirrors {@link StoragePort} but carries
 * binary bytes and a native save dialog. Reused by the cutting list / BOM (F-042) and export (F-043)
 * features, so it lives on the host rather than being folded into the print feature.
 */
export interface ExportPort {
  /**
   * Show a save dialog seeded with `suggestedName` and write the bytes. Resolves to the chosen path,
   * or `null` if the user cancelled.
   */
  savePdf(suggestedName: string, bytes: Uint8Array): Promise<string | null>
  /**
   * Show a save dialog and write a UTF-8 text document. Resolves to the chosen path, or `null` if
   * the user cancelled. Parallel to {@link savePdf} but for text payloads. Used for the F-042 CSV and
   * the F-043 SVG / DXF exports (the host picks the dialog filter from the suggested extension).
   */
  saveText(suggestedName: string, text: string): Promise<string | null>
  /**
   * Show a save dialog and write raw image bytes (the F-043 PNG snapshot). Resolves to the chosen
   * path, or `null` if the user cancelled. Parallel to {@link savePdf} but tagged as an image.
   */
  savePng(suggestedName: string, bytes: Uint8Array): Promise<string | null>
}

/**
 * Reading a file to import into the active document (F-050 SVG import). Mirrors the read half of
 * {@link StoragePort} but with its own dialog filter (`.svg`), so the import affordance is distinct
 * from opening a `.vitrum` project. Kept on the host (not folded into the feature) so `packages/ui`
 * stays Electron-free; the desktop host shows a native open dialog, the browser stub uses a file
 * input, and an env override isolates E2E runs.
 */
/** A raster image the user chose to import as a reference underlay (F-051). */
export interface OpenedImage {
  readonly path: string
  readonly mime: string
  readonly bytes: Uint8Array
}

export interface ImportPort {
  /** Show an open dialog filtered to SVG and read the chosen file. Resolves to null if cancelled. */
  openSvg(): Promise<OpenedFile | null>
  /**
   * Show an open dialog filtered to raster images (PNG/JPEG/WebP) and read the chosen file as
   * bytes (F-051 reference underlay). Resolves to null if cancelled. Optional so an older host
   * without image support degrades gracefully (the "add reference image" action hides).
   */
  openImage?(): Promise<OpenedImage | null>
}

export interface AppHost {
  /** File dialogs, disk I/O and crash-recovery snapshots. */
  readonly storage: StoragePort
  /**
   * The global glass library's persistent storage and JSON import/export (F-022). Absent means the
   * host does not persist a global library — the UI then keeps an in-memory starter library for
   * the session only.
   */
  readonly glassLibrary?: GlassLibraryPort
  /**
   * Writing generated PDFs to disk (F-041). Absent means the host cannot export (the print action is
   * then unavailable); the browser stub downloads the file instead.
   */
  readonly export?: ExportPort
  /**
   * Reading an SVG file to import into the active document (F-050). Absent means import is
   * unavailable (the import action is hidden); present on both the desktop and browser hosts.
   */
  readonly import?: ImportPort
  /**
   * Per-document version history storage + thumbnail cache (F-055). Absent means the host does not
   * persist history — the UI then keeps an in-memory session history. Backed by the app-data
   * directory on the desktop, `localStorage` in the browser, in-memory in tests. (Named
   * `versionStore` rather than `versions` to avoid clashing with the preload's version-strings.)
   */
  readonly versionStore?: VersionPort
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
