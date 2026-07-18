import { line, vec2 } from '@vitrum/geometry'
import {
  Autosaver,
  addSegment,
  createEmptyProject,
  createSegment,
  deserialize,
  DocumentStore,
  serialize,
} from '@vitrum/model'
import type { Project } from '@vitrum/model'

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
  #offMenu: (() => void) | undefined

  doc = $state<Project>(createEmptyProject())
  canUndo = $state(false)
  canRedo = $state(false)
  isDirty = $state(false)
  currentPath = $state<string | null>(null)
  paletteOpen = $state(false)

  segmentCount = $derived(Object.keys(this.doc.segments).length)

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

  undo = (): void => this.#store.undo()
  redo = (): void => this.#store.redo()
  togglePalette = (): void => {
    this.paletteOpen = !this.paletteOpen
  }

  /** Debug-only: append a lead segment so the command/undo/save machinery is exercisable. */
  addDebugSegment = (): void => {
    const y = this.segmentCount * 10
    this.#store.execute(addSegment(createSegment(line(vec2(0, y), vec2(100, y)))))
  }

  newDocument = async (): Promise<void> => {
    if (!(await this.#confirmDiscard())) return
    this.#store.load(createEmptyProject())
    this.currentPath = null
    await this.#host.storage.clearAutosave()
  }

  open = async (): Promise<void> => {
    if (!(await this.#confirmDiscard())) return
    const file = await this.#host.storage.openFile()
    if (!file) return
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
    await this.#host.storage.saveFile(this.currentPath, serialize(this.#store.document))
    this.#store.markSaved()
    await this.#host.storage.clearAutosave()
  }

  saveAs = async (): Promise<void> => {
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
