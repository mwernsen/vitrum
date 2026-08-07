import { traceBitmap, type GreyBitmap, type TraceGrid, type TraceOptions } from '@vitrum/core'
import type { TraceResult } from '@vitrum/core'

/**
 * How the shell runs the autotrace pipeline (F-059 FR-7: the live preview stays usable on a
 * 2000 × 1500 scan). The pipeline is a pure function of pixels + settings; this seam lifts it onto a
 * worker so no slider release ever blocks the draw thread, while tests (and any environment without
 * workers) run it inline. Same result either way — the pipeline is deterministic (FR-6).
 *
 * A trace of a full-resolution sheet is a few hundred milliseconds, not a few seconds, so there is no
 * progress reporting and no cancellation: a superseded request is simply ignored by the controller,
 * which keeps only the newest one.
 */
export interface TraceRequest {
  readonly image: GreyBitmap
  readonly grid: TraceGrid
  readonly options: TraceOptions
}

export interface TraceRunner {
  run(request: TraceRequest): Promise<TraceResult>
  dispose(): void
}

/** Runs the pipeline inline on the calling thread. Used in component tests and as the fallback. */
export class SyncTraceRunner implements TraceRunner {
  run(request: TraceRequest): Promise<TraceResult> {
    return Promise.resolve(traceBitmap(request.image, request.grid, request.options))
  }
  dispose(): void {}
}

interface Pending {
  resolve: (result: TraceResult) => void
  reject: (error: Error) => void
}

/**
 * Runs the pipeline on a dedicated **classic** worker (see `trace.worker.ts` for why classic).
 * Requests are correlated by an incrementing id. If the worker can't load it marks itself broken and
 * rejects, so the controller falls back to a synchronous run rather than hanging — the F-030 lesson:
 * a module worker is silently blocked under `file://` in the packaged renderer.
 */
export class WorkerTraceRunner implements TraceRunner {
  readonly #worker: Worker
  #seq = 0
  #broken = false
  readonly #pending = new Map<number, Pending>()

  constructor() {
    this.#worker = new Worker(new URL('./trace.worker.ts', import.meta.url))
    this.#worker.onmessage = (event: MessageEvent<{ id: number; result: TraceResult }>) => {
      const entry = this.#pending.get(event.data.id)
      if (!entry) return
      this.#pending.delete(event.data.id)
      entry.resolve(event.data.result)
    }
    this.#worker.onerror = (event) => this.#fail(event.message || 'trace worker failed to load')
    this.#worker.onmessageerror = () => this.#fail('trace worker could not deserialize a message')
  }

  #fail(message: string): void {
    this.#broken = true
    const entries = [...this.#pending.values()]
    this.#pending.clear()
    for (const { reject } of entries) reject(new Error(message))
  }

  run(request: TraceRequest): Promise<TraceResult> {
    if (this.#broken) return Promise.reject(new Error('trace worker unavailable'))
    const id = ++this.#seq
    return new Promise<TraceResult>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#worker.postMessage({ id, request })
    })
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
export function createTraceRunner(): TraceRunner {
  if (typeof Worker === 'undefined') return new SyncTraceRunner()
  try {
    return new WorkerTraceRunner()
  } catch {
    return new SyncTraceRunner()
  }
}
