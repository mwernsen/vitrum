import { nestSheets, type NestInput, type NestProgress, type NestResult } from '@vitrum/nest'

/**
 * How the shell runs the nesting engine (F-057 FR-2: a worker with progress and cancel). The engine
 * is a pure function; this seam lifts it onto a worker so a large nest never blocks the UI, while
 * tests (and any environment without workers) run it synchronously. Same result either way.
 */
export interface NestRunner {
  run(input: NestInput, onProgress: (p: NestProgress) => void): Promise<NestResult>
  /** Abort the in-flight run (rejects its promise). No-op for the synchronous runner. */
  cancel(): void
  dispose(): void
}

/** Runs the engine inline on the calling thread. Used in tests and as the no-worker fallback. */
export class SyncNestRunner implements NestRunner {
  run(input: NestInput, onProgress: (p: NestProgress) => void): Promise<NestResult> {
    return Promise.resolve(nestSheets(input, onProgress))
  }
  // A synchronous run has already completed by the time cancel() could be called — nothing to abort.
  cancel(): void {}
  dispose(): void {}
}

interface Pending {
  resolve: (result: NestResult) => void
  reject: (error: Error) => void
  onProgress: (p: NestProgress) => void
}

type WorkerMessage =
  | { id: number; type: 'progress'; progress: NestProgress }
  | { id: number; type: 'done'; result: NestResult }

/**
 * Runs the engine on a dedicated **classic** worker (see `nest.worker.ts` for why classic). Requests
 * are correlated by an incrementing id; progress messages are forwarded to the active run's callback.
 * Cancellation terminates the worker outright — a single `nestSheets` call is synchronous, so the only
 * way to stop it is to kill the thread — then a fresh worker is spun up for the next run. If the worker
 * can't load it marks itself broken and rejects, so the controller falls back to a synchronous run.
 */
export class WorkerNestRunner implements NestRunner {
  #worker: Worker
  #seq = 0
  #broken = false
  #pending = new Map<number, Pending>()

  constructor() {
    this.#worker = this.#spawn()
  }

  #spawn(): Worker {
    const worker = new Worker(new URL('./nest.worker.ts', import.meta.url))
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const msg = event.data
      const entry = this.#pending.get(msg.id)
      if (!entry) return
      if (msg.type === 'progress') {
        entry.onProgress(msg.progress)
      } else {
        this.#pending.delete(msg.id)
        entry.resolve(msg.result)
      }
    }
    worker.onerror = (event) => this.#fail(event.message || 'nest worker failed to load')
    worker.onmessageerror = () => this.#fail('nest worker could not deserialize a message')
    return worker
  }

  #fail(message: string): void {
    this.#broken = true
    const entries = [...this.#pending.values()]
    this.#pending.clear()
    for (const { reject } of entries) reject(new Error(message))
  }

  run(input: NestInput, onProgress: (p: NestProgress) => void): Promise<NestResult> {
    if (this.#broken) return Promise.reject(new Error('nest worker unavailable'))
    const id = ++this.#seq
    return new Promise<NestResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, onProgress })
      this.#worker.postMessage({ id, input })
    })
  }

  cancel(): void {
    if (this.#pending.size === 0) return
    const entries = [...this.#pending.values()]
    this.#pending.clear()
    // Kill the busy worker and start a fresh one for the next run.
    this.#worker.terminate()
    this.#worker = this.#spawn()
    for (const { reject } of entries) reject(new Error('nest cancelled'))
  }

  dispose(): void {
    this.#pending.clear()
    this.#worker.terminate()
  }
}

/**
 * Pick the best runner for the environment: a worker when the platform provides one (desktop renderer
 * and `dev:ui`), else the synchronous fallback (jsdom component tests). Worker construction is guarded
 * so a bundler that can't build the worker degrades to sync rather than crashing.
 */
export function createNestRunner(): NestRunner {
  if (typeof Worker === 'undefined') return new SyncNestRunner()
  try {
    return new WorkerNestRunner()
  } catch {
    return new SyncNestRunner()
  }
}
