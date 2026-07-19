import {
  CutContourCache,
  curveEndpoints,
  PieceDetector,
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
  createSegment,
  deserialize,
  DocumentStore,
  outputSegments,
  removeSegments,
  serialize,
} from '@vitrum/model'
import type { Command, ExecuteOptions, Project } from '@vitrum/model'

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
   * Optional hook run immediately before a file save (F-023): the shell sets it to materialise
   * inherited glass assignments under each live piece's current content id, so colours reshaped or
   * split mid-session persist across reload (FR-5). Runs synchronously through {@link execute}, so
   * the serialized document reflects it.
   */
  onBeforeSave: (() => void) | undefined

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
   */
  detect = (): DetectionResult => this.#detector.update(outputSegments(this.doc))

  /**
   * Derive the technique-aware cut contours for the given pieces (F-021), inset from the drawn
   * boundary by the lead-came heart / copper-foil allowance. Cached alongside piece detection: an
   * unchanged piece with unchanged came settings reuses its contour; a technique switch or a
   * per-segment override recomputes only the affected pieces. Callers pass the pieces from
   * {@link detect} so the two stay in sync.
   */
  cutContours = (pieces: readonly Piece[]): CutContour[] =>
    this.#cutCache.update(pieces, outputSegments(this.doc), this.doc.technique)

  undo = (): void => this.#store.undo()
  redo = (): void => this.#store.redo()

  /**
   * Apply one document command. The sanctioned mutation path for drawing tools (F-011):
   * each completed gesture calls this exactly once, so it is a single undo entry (FR-1).
   */
  execute = (command: Command, options?: ExecuteOptions): void =>
    this.#store.execute(command, options)
  togglePalette = (): void => {
    this.paletteOpen = !this.paletteOpen
  }

  /**
   * Remove every construction guide in one reversible command (F-012 "clear all guides").
   * A no-op when there are no guides.
   */
  clearGuides = (): void => {
    const ids = constructionSegmentIds(this.#store.document)
    if (ids.length > 0) this.#store.execute(removeSegments(ids))
  }

  /** Debug-only: append a lead segment so the command/undo/save machinery is exercisable. */
  addDebugSegment = (): void => {
    const y = this.segmentCount * 10
    this.#store.execute(addSegment(createSegment(line(vec2(0, y), vec2(100, y)))))
  }

  /** Debug-only: load a dense generated scene to stress-test canvas pan/zoom (F-003 FR-4). */
  loadStressScene = (count = 5000): void => {
    this.#detector.reset()
    this.#cutCache.reset()
    this.#store.load(stressScene(count))
    this.currentPath = null
  }

  newDocument = async (): Promise<void> => {
    if (!(await this.#confirmDiscard())) return
    this.#detector.reset()
    this.#cutCache.reset()
    this.#store.load(createEmptyProject())
    this.currentPath = null
    await this.#host.storage.clearAutosave()
  }

  open = async (): Promise<void> => {
    if (!(await this.#confirmDiscard())) return
    const file = await this.#host.storage.openFile()
    if (!file) return
    this.#detector.reset()
    this.#cutCache.reset()
    this.#store.load(deserialize(file.contents))
    this.currentPath = file.path
    await this.#host.storage.clearAutosave()
  }

  /** Silent save in place (Cmd-S); falls back to Save-As for a document with no path. */
  save = async (): Promise<void> => {
    if (this.currentPath === null) {
      await this.saveAs()
      return
    }
    this.onBeforeSave?.()
    await this.#host.storage.saveFile(this.currentPath, serialize(this.#store.document))
    this.#store.markSaved()
    await this.#host.storage.clearAutosave()
  }

  saveAs = async (): Promise<void> => {
    this.onBeforeSave?.()
    const path = await this.#host.storage.saveFileAs(
      this.#suggestedName(),
      serialize(this.#store.document),
    )
    if (path === null) return
    this.currentPath = path
    this.#store.markSaved()
    await this.#host.storage.clearAutosave()
  }

  /** Restore an autosave snapshot after a crash. The result is treated as unsaved. */
  recover = (contents: string): void => {
    this.#detector.reset()
    this.#cutCache.reset()
    this.#store.load(deserialize(contents))
    this.currentPath = null
  }

  #runMenuAction(action: MenuAction): void {
    switch (action) {
      case 'new':
        void this.newDocument()
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
