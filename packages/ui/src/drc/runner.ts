import { runChecks, type DrcInput, type RunResult } from '@vitrum/drc'

/**
 * How the shell runs the DRC engine (F-030 FR-1). The engine itself is a pure function; this seam
 * lets the app lift it onto a worker so a live run never blocks drawing, while tests (and any
 * environment without workers) run it synchronously. Same result either way — the worker just moves
 * the work off the main thread.
 */
export interface DrcRunner {
  run(input: DrcInput): Promise<RunResult>
  dispose(): void
}

/** Runs the engine inline on the calling thread. Used in tests and as the no-worker fallback. */
export class SyncDrcRunner implements DrcRunner {
  run(input: DrcInput): Promise<RunResult> {
    return Promise.resolve(runChecks(input))
  }
  dispose(): void {}
}

/**
 * Runs the engine on a dedicated module worker, so a full run on a large panel never stalls the
 * draw thread (FR-1). Requests are correlated by an incrementing id, so an in-flight run whose
 * input is already stale is simply superseded when its resolver is dropped.
 *
 * The worker is a **classic** (IIFE) worker, not a module worker: Vite inlines its imports into one
 * self-contained script, which loads under `file://` in the packaged desktop app where a
 * `{ type: 'module' }` worker is blocked. If it still can't load, it marks itself broken and
 * rejects, so the controller falls back to a synchronous run rather than hanging.
 */
export class WorkerDrcRunner implements DrcRunner {
  readonly #worker: Worker
  #seq = 0
  #broken = false
  readonly #pending = new Map<
    number,
    { resolve: (result: RunResult) => void; reject: (error: Error) => void }
  >()

  constructor() {
    this.#worker = new Worker(new URL('./drc.worker.ts', import.meta.url))
    this.#worker.onmessage = (event: MessageEvent<{ id: number; result: RunResult }>) => {
      const { id, result } = event.data
      const entry = this.#pending.get(id)
      if (entry) {
        this.#pending.delete(id)
        entry.resolve(result)
      }
    }
    this.#worker.onerror = (event) => this.#fail(event.message || 'drc worker failed to load')
    this.#worker.onmessageerror = () => this.#fail('drc worker could not deserialize a message')
  }

  #fail(message: string): void {
    this.#broken = true
    const entries = [...this.#pending.values()]
    this.#pending.clear()
    for (const { reject } of entries) reject(new Error(message))
  }

  run(input: DrcInput): Promise<RunResult> {
    if (this.#broken) return Promise.reject(new Error('drc worker unavailable'))
    const id = ++this.#seq
    return new Promise<RunResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#worker.postMessage({ id, input })
    })
  }

  dispose(): void {
    this.#pending.clear()
    this.#worker.terminate()
  }
}

/**
 * Pick the best runner for the environment: a worker when the platform provides one (the desktop
 * renderer and `dev:ui`), else the synchronous fallback (jsdom component tests). Worker construction
 * is guarded so a bundler that can't build the worker degrades to sync rather than crashing.
 */
export function createDrcRunner(): DrcRunner {
  if (typeof Worker === 'undefined') return new SyncDrcRunner()
  try {
    return new WorkerDrcRunner()
  } catch {
    return new SyncDrcRunner()
  }
}
