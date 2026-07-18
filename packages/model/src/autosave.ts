import { serialize } from './serialize'
import type { DocumentStore } from './store'

/** Opaque timer handle — whatever the injected scheduler returns. */
export type TimerHandle = unknown

/**
 * Timer injection. The model package carries no DOM or Node typings, so the concrete
 * timer is supplied by the host (the UI adapter passes `setTimeout`/`clearTimeout`;
 * tests pass a fake clock). This keeps autosave logic deterministically testable.
 */
export interface Scheduler {
  setTimer(fn: () => void, ms: number): TimerHandle
  clearTimer(handle: TimerHandle): void
}

export interface AutosaverOptions {
  readonly store: DocumentStore
  readonly scheduler: Scheduler
  /** Persist a recovery snapshot (typically `StoragePort.writeAutosave`). */
  write(contents: string): void | Promise<void>
  /** Throttle interval; a snapshot is written at most once per this window. Default 5000. */
  readonly intervalMs?: number
  /** Reported if a snapshot write rejects; autosave never throws into the app. */
  onError?(error: unknown): void
}

/**
 * Crash-recovery autosave (FR-5). While the document is dirty it writes a snapshot to the
 * app-data directory at most once every `intervalMs` (default 5 s). It does NOT mark the
 * document saved — the snapshot is a safety net, not the user's file — so on startup the
 * presence of a snapshot signals an unclean exit and the app can offer recovery.
 */
export class Autosaver {
  readonly #store: DocumentStore
  readonly #scheduler: Scheduler
  readonly #write: (contents: string) => void | Promise<void>
  readonly #intervalMs: number
  readonly #onError: (error: unknown) => void

  #unsubscribe: (() => void) | undefined
  #pending: TimerHandle | undefined

  constructor(options: AutosaverOptions) {
    this.#store = options.store
    this.#scheduler = options.scheduler
    this.#write = options.write
    this.#intervalMs = options.intervalMs ?? 5000
    this.#onError = options.onError ?? (() => {})
  }

  /** Begin watching the store. */
  start(): void {
    if (this.#unsubscribe) return
    this.#unsubscribe = this.#store.subscribe(() => this.#onChange())
  }

  /** Stop watching and cancel any pending snapshot. */
  stop(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
    if (this.#pending !== undefined) {
      this.#scheduler.clearTimer(this.#pending)
      this.#pending = undefined
    }
  }

  /** Write a snapshot immediately if the document is dirty (e.g. before a clean quit). */
  flush(): void {
    if (this.#store.isDirty) this.#snapshot()
  }

  #onChange(): void {
    // Schedule at most one write per interval: a burst of edits collapses to one snapshot.
    if (!this.#store.isDirty || this.#pending !== undefined) return
    this.#pending = this.#scheduler.setTimer(() => {
      this.#pending = undefined
      if (this.#store.isDirty) this.#snapshot()
    }, this.#intervalMs)
  }

  #snapshot(): void {
    try {
      const result = this.#write(serialize(this.#store.document))
      if (result instanceof Promise) result.catch((error: unknown) => this.#onError(error))
    } catch (error) {
      this.#onError(error)
    }
  }
}
