import {
  CutContourCache,
  curveEndpoints,
  expandNetwork,
  expandReplicas,
  PieceDetector,
  pieceOrbits,
  type CutContour,
  type DetectionResult,
  type Piece,
} from '@vitrum/core'
import { line, vec2 } from '@vitrum/geometry'
import {
  Autosaver,
  addSegment,
  constructionSegmentIds,
  createEmptyProject,
  createPanelProject,
  createSegment,
  DocumentStore,
  editableCopy,
  isReadOnly,
  outputSegments,
  packDocument,
  removeSegments,
  replaceProject,
  sharedProject,
  unpackDocument,
} from '@vitrum/model'
import type {
  AssetId,
  Command,
  ExecuteOptions,
  NewPanelSpec,
  PanelFacts,
  Project,
  ReferenceAsset,
  Segment,
} from '@vitrum/model'

import { SvelteMap } from 'svelte/reactivity'

import { stressScene } from '../canvas/scene'

import type { AppHost, MenuAction } from './host'

/**
 * The reactive bridge between the UI and the framework-free `DocumentStore` (F-002). It
 * mirrors store state into Svelte runes, exposes the user actions (undo/redo, new/open/
 * save/save-as, plus a debug "add segment"), and owns the autosave loop and the
 * unsaved-changes guard. The store remains the single source of truth; this class holds
 * no document state of its own beyond what it copies for reactivity.
 */
export class DocumentController {
  readonly #store: DocumentStore
  readonly #host: AppHost
  readonly #autosaver: Autosaver
  readonly #detector = new PieceDetector()
  readonly #cutCache = new CutContourCache()
  #offMenu: (() => void) | undefined

  doc = $state<Project>(createEmptyProject())
  canUndo = $state(false)
  canRedo = $state(false)
  isDirty = $state(false)
  currentPath = $state<string | null>(null)
  paletteOpen = $state(false)
  /**
   * True when the open document came from a shared package (F-055 FR-8): edits are inert until the
   * user chooses "edit a copy". Set on open/recover from the document's `sharedReadOnly` flag.
   */
  readOnly = $state(false)

  /**
   * Optional hook run immediately before a file save (F-023): the shell sets it to materialise
   * inherited glass assignments under each live piece's current content id, so colours reshaped or
   * split mid-session persist across reload (FR-5). Runs synchronously through {@link execute}, so
   * the serialized document reflects it.
   */
  onBeforeSave: (() => void) | undefined

  /**
   * How the reference-image feature (F-051) contributes its embedded image blobs to the `.vitrum`
   * zip. `collectAssets` gathers the bytes for every layer at save/autosave time; `loadAssets`
   * hands back the bytes read from a file on open/recover. Both default to empty so a build without
   * the reference feature (or a test) still saves and loads a document with no images.
   */
  collectAssets: () => ReadonlyMap<AssetId, ReferenceAsset> = () => new SvelteMap()
  loadAssets: (assets: ReadonlyMap<AssetId, ReferenceAsset>) => void = () => {}

  /**
   * What the "New" command does (F-058 FR-3). The shell sets it to open the new-panel dialog, so
   * Cmd-N and the native File ▸ New both ask for a name, size and technique instead of silently
   * dropping a blank document. Unset ⇒ the F-002 behaviour ({@link newDocument}).
   */
  onNewPanel: (() => void) | undefined

  /**
   * Called with the file's path after a successful save (F-058): the shell records the panel in the
   * library so a freshly saved document appears in the grid, with a preview keyed to the file's new
   * modification time (FR-2/FR-6).
   */
  onSaved: ((path: string) => void) | undefined

  /**
   * The open panel's derived figures for the library index (F-058 FR-10), supplied by the shell —
   * which is where piece detection, glass assignment, DRC and the BOM are already computed. Read on the
   * save path only, so nothing extra runs while editing. Mirrors {@link onBeforeSave} /
   * {@link collectAssets}: the document layer asks, the shell answers.
   */
  indexFacts: (() => PanelFacts) | undefined

  segmentCount = $derived(Object.keys(this.doc.segments).length)

  /**
   * The number of distinct endpoint coordinates in the network, deduped bit-identically.
   * When snapping welds an endpoint (F-012 FR-1), the two segments share one coordinate, so
   * this count drops — the observable the debug panel and the F-012 E2E use to prove welds.
   */
  distinctNodeCount = $derived.by(() => {
    const seen: Record<string, true> = {}
    for (const segment of Object.values(this.doc.segments)) {
      for (const p of curveEndpoints(segment.geometry)) seen[`${p.x},${p.y}`] = true
    }
    return Object.keys(seen).length
  })

  constructor(host: AppHost, store: DocumentStore = new DocumentStore()) {
    this.#store = store
    this.#host = host

    this.#sync()
    store.subscribe(() => this.#sync())

    this.#autosaver = new Autosaver({
      store,
      scheduler: {
        setTimer: (fn, ms) => setTimeout(fn, ms),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      serialize: (doc) => packDocument(doc, this.collectAssets()),
      write: (contents) => host.storage.writeAutosave(contents),
    })
    this.#autosaver.start()

    this.#offMenu = host.onMenuAction?.((action) => this.#runMenuAction(action))
  }

  /** Tear down subscriptions and timers (call on unmount). */
  dispose(): void {
    this.#autosaver.stop()
    this.#offMenu?.()
  }

  /**
   * Derive the glass pieces and diagnostics from the current network (F-020). Computed on
   * demand rather than reactively, so it stays off the hot path of the debug stress scene;
   * callers memoise it against `doc` (the dev overlay and the debug palette both do). Uses
   * the incremental `PieceDetector`, so redrawing one line reuses unchanged components and
   * keeps piece ids stable across the session (FR-3/FR-5).
   *
   * Also tags the generation with its symmetry **orbits** (F-052): which pieces are live replicas of
   * which, so glass assignment resolves a replica's colour from the piece it repeats instead of
   * leaving every sector to be painted by hand. This is the seam that already owns expansion, and
   * detection stays symmetry-agnostic. Absent (and free) when symmetry is off.
   */
  detect = (): DetectionResult => {
    const result = this.#detector.update(this.outputNetwork())
    const symLineage = pieceOrbits(result.pieces, this.doc.symmetry)
    return Object.keys(symLineage).length === 0 ? result : { ...result, symLineage }
  }

  /**
   * The full output network piece detection, DRC and every export operate on (F-052): the source
   * output segments plus the live symmetry replicas, expanded by the pure `@vitrum/core` transform.
   * With symmetry off this is just `outputSegments(doc)`, unchanged. Replicas are derived on demand
   * and never stored — the document keeps only source + setup (Decision §2).
   */
  outputNetwork = (): Segment[] =>
    expandNetwork(outputSegments(this.doc), this.doc.symmetry) as Segment[]

  /** Only the derived symmetry replicas (empty when symmetry is off) — the read-only linework. */
  replicaNetwork = (): Segment[] =>
    expandReplicas(outputSegments(this.doc), this.doc.symmetry) as Segment[]

  /**
   * Derive the technique-aware cut contours for the given pieces (F-021), inset from the drawn
   * boundary by the lead-came heart / copper-foil allowance. Cached alongside piece detection: an
   * unchanged piece with unchanged came settings reuses its contour; a technique switch or a
   * per-segment override recomputes only the affected pieces. Callers pass the pieces from
   * {@link detect} so the two stay in sync.
   */
  cutContours = (pieces: readonly Piece[]): CutContour[] =>
    this.#cutCache.update(pieces, this.outputNetwork(), this.doc.technique)

  undo = (): void => {
    if (this.readOnly) return
    this.#store.undo()
  }
  redo = (): void => {
    if (this.readOnly) return
    this.#store.redo()
  }

  /**
   * Apply one document command. The sanctioned mutation path for drawing tools (F-011):
   * each completed gesture calls this exactly once, so it is a single undo entry (FR-1).
   * Inert while the document is read-only (F-055 FR-8) — a shared package cannot be edited in place.
   */
  execute = (command: Command, options?: ExecuteOptions): void => {
    if (this.readOnly) return
    this.#store.execute(command, options)
  }

  /**
   * Restore a version snapshot as a single undoable step (F-055 FR-2): the whole document is
   * replaced through one `replaceProject` command, so Cmd-Z returns to the pre-restore state.
   */
  restoreProject = (project: Project): void => {
    if (this.readOnly) return
    this.#store.execute(replaceProject(project))
  }

  /** Load a version snapshot as a fresh untitled, editable copy (F-055 FR-2 "open copy"). */
  openCopyProject = (project: Project): void => {
    this.#detector.reset()
    this.#cutCache.reset()
    this.#store.load(project)
    this.currentPath = null
    this.readOnly = false
  }

  /**
   * Detach a shared read-only document into a fresh, editable untitled copy (F-055 FR-8): the
   * read-only flag and share note are dropped and the file path is cleared, so the hand-off original
   * is never overwritten in place.
   */
  editCopy = async (): Promise<void> => {
    this.#detector.reset()
    this.#cutCache.reset()
    this.#store.load(editableCopy(this.#store.document))
    this.currentPath = null
    this.readOnly = false
    await this.#host.storage.clearAutosave()
  }

  /**
   * Write a self-contained `.vitrum` copy for sharing (F-055 FR-7): a read-only-flagged package with
   * an optional watermark note, carrying no history or autosave state (both live outside the file).
   * The working document is unchanged. Resolves to the chosen path, or null if cancelled.
   */
  exportForSharing = async (note?: string): Promise<string | null> => {
    this.onBeforeSave?.()
    const bytes = packDocument(sharedProject(this.#store.document, note), this.collectAssets())
    return this.#host.storage.saveFileAs(this.#suggestedName(), bytes)
  }
  togglePalette = (): void => {
    this.paletteOpen = !this.paletteOpen
  }

  /**
   * Remove every construction guide in one reversible command (F-012 "clear all guides").
   * A no-op when there are no guides.
   */
  clearGuides = (): void => {
    const ids = constructionSegmentIds(this.#store.document)
    if (ids.length > 0) this.execute(removeSegments(ids))
  }

  /** Debug-only: append a lead segment so the command/undo/save machinery is exercisable. */
  addDebugSegment = (): void => {
    const y = this.segmentCount * 10
    this.execute(addSegment(createSegment(line(vec2(0, y), vec2(100, y)))))
  }

  /** Debug-only: load a dense generated scene to stress-test canvas pan/zoom (F-003 FR-4). */
  loadStressScene = (count = 5000): void => {
    this.#detector.reset()
    this.#cutCache.reset()
    this.#store.load(stressScene(count))
    this.currentPath = null
    this.readOnly = false
  }

  newDocument = async (): Promise<void> => {
    if (!(await this.#confirmDiscard())) return
    this.#detector.reset()
    this.#cutCache.reset()
    this.#store.load(createEmptyProject())
    this.currentPath = null
    this.readOnly = false
    await this.#host.storage.clearAutosave()
  }

  /** Open a file through the native dialog. Resolves false when cancelled (F-058 needs to know). */
  open = async (): Promise<boolean> => {
    if (!(await this.#confirmDiscard())) return false
    const file = await this.#host.storage.openFile()
    if (!file) return false
    this.#load(file.path, file.contents)
    await this.#host.storage.clearAutosave()
    return true
  }

  /**
   * Ask about unsaved changes, if there are any (F-058). Exposed so the shell can guard leaving the
   * editor for the launch screen with the same prompt open/new use (FR-5). True ⇒ go ahead.
   */
  confirmDiscardIfDirty = (): Promise<boolean> => this.#confirmDiscard()

  /**
   * Open a `.vitrum` file by path, with no dialog — how the panel library opens an entry, how a file
   * the app was launched with is loaded, and where a dropped file ends up (F-058 FR-1/FR-2/FR-4).
   * Replaces the open document in place, behind the unsaved-changes guard (Open question 2). Resolves
   * false when the user cancelled, the host cannot read paths, or the file is missing/not a panel.
   */
  openPath = async (path: string): Promise<boolean> => {
    const read = this.#host.storage.readFile
    if (!read) return false
    if (!(await this.#confirmDiscard())) return false
    const file = await read.call(this.#host.storage, path)
    if (!file) return false
    return this.#openBytes(file.path, file.contents)
  }

  /**
   * Open already-read `.vitrum` bytes under a path (F-058 FR-4 drag-and-drop, where the browser hands
   * us the file's contents directly). Behind the unsaved-changes guard, like {@link openPath}.
   * Resolves false when the user cancelled or the bytes are not a readable panel.
   */
  openBytes = async (path: string, contents: Uint8Array): Promise<boolean> => {
    if (!(await this.#confirmDiscard())) return false
    return this.#openBytes(path, contents)
  }

  /**
   * Start a new panel from the new-panel dialog's choices (F-058 FR-3): the document enters the
   * editor with the chosen settings and technique, an empty undo history, and no file path — it is
   * unsaved until the user chooses where it lives (Open question 1, "Save-As decides"). Resolves
   * false when the user kept their unsaved changes instead.
   */
  newPanel = async (spec: NewPanelSpec): Promise<boolean> => {
    if (!(await this.#confirmDiscard())) return false
    this.#detector.reset()
    this.#cutCache.reset()
    this.#store.load(createPanelProject(spec))
    this.currentPath = null
    this.readOnly = false
    await this.#host.storage.clearAutosave()
    return true
  }

  /** Load document bytes into the store. Returns false for anything that is not a readable panel. */
  async #openBytes(path: string, contents: Uint8Array): Promise<boolean> {
    try {
      this.#load(path, contents)
    } catch {
      return false
    }
    await this.#host.storage.clearAutosave()
    return true
  }

  #load(path: string, contents: Uint8Array): void {
    const { project, assets } = unpackDocument(contents)
    this.#detector.reset()
    this.#cutCache.reset()
    this.loadAssets(assets)
    this.#store.load(project)
    this.currentPath = path
    this.readOnly = isReadOnly(project)
  }

  /** Silent save in place (Cmd-S); falls back to Save-As for a document with no path. */
  save = async (): Promise<void> => {
    if (this.currentPath === null) {
      await this.saveAs()
      return
    }
    this.onBeforeSave?.()
    await this.#host.storage.saveFile(this.currentPath, this.#packFile())
    this.#store.markSaved()
    await this.#host.storage.clearAutosave()
    this.onSaved?.(this.currentPath)
  }

  saveAs = async (): Promise<void> => {
    this.onBeforeSave?.()
    const path = await this.#host.storage.saveFileAs(this.#suggestedName(), this.#packFile())
    if (path === null) return
    this.currentPath = path
    this.#store.markSaved()
    await this.#host.storage.clearAutosave()
    this.onSaved?.(path)
  }

  /** Restore an autosave snapshot after a crash. The result is treated as unsaved. */
  recover = (contents: Uint8Array): void => {
    this.#detector.reset()
    this.#cutCache.reset()
    const { project, assets } = unpackDocument(contents)
    this.loadAssets(assets)
    this.#store.load(project)
    this.currentPath = null
    this.readOnly = isReadOnly(project)
  }

  /** Pack the current document plus its reference-image assets into the `.vitrum` zip bytes. */
  #packFile(): Uint8Array {
    return packDocument(this.#store.document, this.collectAssets())
  }

  #runMenuAction(action: MenuAction): void {
    switch (action) {
      case 'new':
        // F-058 FR-3: "New" opens the new-panel dialog when the shell offers one.
        if (this.onNewPanel) this.onNewPanel()
        else void this.newDocument()
        break
      case 'open':
        void this.open()
        break
      case 'save':
        void this.save()
        break
      case 'saveAs':
        void this.saveAs()
        break
      case 'undo':
        this.undo()
        break
      case 'redo':
        this.redo()
        break
      case 'togglePalette':
        this.togglePalette()
        break
    }
  }

  #suggestedName(): string {
    const name = this.#store.document.settings.name || 'Untitled'
    return name.endsWith('.vitrum') ? name : `${name}.vitrum`
  }

  async #confirmDiscard(): Promise<boolean> {
    if (!this.#store.isDirty) return true
    return this.#host.confirmDiscard ? this.#host.confirmDiscard() : true
  }

  #sync(): void {
    this.doc = this.#store.document
    this.canUndo = this.#store.canUndo
    this.canRedo = this.#store.canRedo
    this.isDirty = this.#store.isDirty
    this.#host.reportDirty?.(this.#store.isDirty)
  }
}
