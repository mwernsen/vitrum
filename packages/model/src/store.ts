import type { Command } from './commands'
import { createEmptyProject } from './types'
import type { Project } from './types'

/** Options for `execute`. */
export interface ExecuteOptions {
  /**
   * Coalesce this command into the previous history entry when they share a key and the
   * previous command's `merge` accepts it. A drawing tool passes one stable key for the
   * whole of a drag, so the drag collapses to a single undo step, and a fresh key per
   * interaction so distinct edits stay separate.
   */
  readonly coalesceKey?: string
}

interface HistoryEntry {
  readonly command: Command
  readonly inverse: Command
  readonly coalesceKey: string | undefined
}

/** Called on every state change so the UI can re-read the store. */
export type Listener = () => void

/**
 * The document store (F-002). Owns the current `Project` and the undo/redo history, and
 * is the sole gateway for mutation: callers hand it semantic `Command`s via `execute`
 * (FR-1) and it maintains an exact, unlimited undo/redo log (FR-2). It holds no DOM or
 * framework dependency — `packages/ui` subscribes through a thin adapter.
 */
export class DocumentStore {
  #doc: Project
  #undo: HistoryEntry[] = []
  #redo: HistoryEntry[] = []
  #dirty = false
  #listeners = new Set<Listener>()

  constructor(initial: Project = createEmptyProject()) {
    this.#doc = initial
  }

  /** The current document. Deeply readonly — mutate only through `execute`. */
  get document(): Project {
    return this.#doc
  }

  get canUndo(): boolean {
    return this.#undo.length > 0
  }

  get canRedo(): boolean {
    return this.#redo.length > 0
  }

  /** True when the document has unsaved changes since the last `markSaved` or `load`. */
  get isDirty(): boolean {
    return this.#dirty
  }

  /** Apply a command, recording it for undo. Clears the redo stack. */
  execute(command: Command, options: ExecuteOptions = {}): void {
    const before = this.#doc
    const after = command.apply(before)
    const inverse = command.invert(before)
    const { coalesceKey } = options

    const top = this.#undo.at(-1)
    if (coalesceKey !== undefined && top && top.coalesceKey === coalesceKey && top.command.merge) {
      const merged = top.command.merge(command)
      if (merged) {
        // Keep the earliest inverse so undo still restores the pre-interaction state.
        this.#undo[this.#undo.length - 1] = { command: merged, inverse: top.inverse, coalesceKey }
        this.#commit(after)
        return
      }
    }

    this.#undo.push({ command, inverse, coalesceKey })
    this.#redo = []
    this.#commit(after)
  }

  /** Undo the most recent history entry. No-op when there is nothing to undo. */
  undo(): void {
    const entry = this.#undo.pop()
    if (!entry) return
    this.#redo.push(entry)
    this.#commit(entry.inverse.apply(this.#doc))
  }

  /** Redo the most recently undone entry. No-op when there is nothing to redo. */
  redo(): void {
    const entry = this.#redo.pop()
    if (!entry) return
    this.#undo.push(entry)
    this.#commit(entry.command.apply(this.#doc))
  }

  /**
   * Replace the whole document (used after loading a file or discarding to a fresh one).
   * History is cleared — you cannot undo across a load — and the document is marked clean.
   */
  load(doc: Project): void {
    this.#doc = doc
    this.#undo = []
    this.#redo = []
    this.#dirty = false
    this.#notify()
  }

  /** Mark the current document as saved (clears the dirty flag). */
  markSaved(): void {
    this.#dirty = false
    this.#notify()
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #commit(doc: Project): void {
    this.#doc = doc
    this.#dirty = true
    this.#notify()
  }

  #notify(): void {
    for (const listener of this.#listeners) listener()
  }
}
