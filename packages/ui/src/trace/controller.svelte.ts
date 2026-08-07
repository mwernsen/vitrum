import {
  defaultTraceOptions,
  traceBitmap,
  type TraceGrid,
  type TraceOptions,
  type TraceResult,
} from '@vitrum/core'
import type { LayerId, ReferenceAsset, ReferenceLayer } from '@vitrum/model'

import { rasteriseLayer, type TraceSource } from './rasterise'
import { createTraceRunner, type TraceRequest, type TraceRunner } from './runner'

/**
 * The reactive owner of the autotrace dialog's state (F-059).
 *
 * It holds the rasterised source grid — computed **once** when the dialog opens, because resampling
 * the layer is the expensive part and no control changes it — the live settings, and the latest
 * preview. Every recompute goes through a {@link TraceRunner}, so the pipeline runs on a worker in the
 * app and inline in tests, and slider drags are debounced with stale results dropped by sequence
 * number (FR-7). None of the actual work is here: binarising, thinning, walking, fitting and healing
 * are all pure `@vitrum/core`, and this class is only the UI seam.
 */
export class TraceController {
  open = $state(false)
  /** True while the layer is being rasterised or a trace is in flight. */
  busy = $state(false)
  error = $state<string | null>(null)

  /** The layer being traced — its name for the dialog's header, its id for the merge. */
  layerName = $state<string | null>(null)
  layerId = $state<LayerId | null>(null)

  /** Live settings. Every control writes here; the heavy recompute is debounced behind them. */
  options = $state<TraceOptions>(defaultTraceOptions())

  /** The newest completed trace: healed segments, the binarised mask, the piece count. */
  preview = $state<TraceResult | null>(null)

  /**
   * How the traced grid sits in world millimetres. The dialog needs it twice: as the read-out of the
   * resolution the trace is running at, and as the transform that puts the previewed mask and the
   * previewed geometry in the same place, so a line lost to the threshold shows as bare ink.
   */
  grid = $state<TraceGrid | null>(null)

  #source: TraceSource | null = null
  readonly #runner: TraceRunner
  readonly #rasterise: Rasteriser
  #timer: ReturnType<typeof setTimeout> | undefined
  /** Request sequence, so a slow trace that has been superseded is discarded rather than shown. */
  #seq = 0
  /** Set once the worker has proved unusable; every trace after that runs inline. */
  #preferSync = false

  constructor(runner: TraceRunner = createTraceRunner(), rasterise: Rasteriser = rasteriseLayer) {
    this.#runner = runner
    this.#rasterise = rasterise
  }

  /** Whether there is anything worth merging. */
  get canTrace(): boolean {
    return (this.preview?.segments.length ?? 0) > 0
  }

  /**
   * Open the dialog on `layer`, rasterise it, and compute the first preview. Refuses an uncalibrated
   * layer with a message pointing at F-051's calibration rather than tracing at a guessed scale
   * (FR-3) — the dialog opens either way, so the refusal is visible instead of silent.
   */
  async load(layer: ReferenceLayer, asset: ReferenceAsset | undefined): Promise<void> {
    this.open = true
    this.busy = true
    this.error = null
    this.preview = null
    this.#source = null
    this.layerName = layer.name
    this.layerId = layer.id
    this.options = defaultTraceOptions()
    try {
      if (!asset) throw new Error('This reference image could not be read.')
      const source = await this.#rasterise(layer, asset)
      this.#source = source
      this.grid = source.grid
      await this.#run()
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      this.busy = false
    }
  }

  /**
   * Change one or more settings. The read-out updates immediately (the value is state); the trace is
   * debounced, so dragging a slider queues one recompute rather than thirty.
   */
  set(patch: Partial<TraceOptions>): void {
    this.options = { ...this.options, ...patch }
    if (!this.#source) return
    this.busy = true
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => void this.#run(), DEBOUNCE_MS)
  }

  /** Recompute now, skipping the debounce. */
  async recompute(): Promise<void> {
    clearTimeout(this.#timer)
    await this.#run()
  }

  close(): void {
    clearTimeout(this.#timer)
    this.open = false
    this.busy = false
    this.error = null
    this.preview = null
    this.layerName = null
    this.layerId = null
    this.grid = null
    this.#source = null
    this.#seq++
  }

  dispose(): void {
    clearTimeout(this.#timer)
    this.#runner.dispose()
  }

  async #run(): Promise<void> {
    const source = this.#source
    if (!source) return
    const seq = ++this.#seq
    this.busy = true
    try {
      // A **plain** request, not the reactive one: `options` is `$state`, so reading it hands back a
      // Proxy, and a Proxy cannot be structured-cloned into a worker ("could not be cloned"). Spreading
      // copies the primitives out; the image comes from a private field and is already plain. The
      // synchronous fallback below would hide a regression here, so a unit test clones the request.
      const request: TraceRequest = {
        image: source.image,
        grid: { ...source.grid, origin: { ...source.grid.origin } },
        options: { ...this.options },
      }
      const result = await this.#exec(request)
      if (seq !== this.#seq) return // superseded by a newer drag
      this.preview = result
      this.error = null
    } catch (error) {
      if (seq !== this.#seq) return
      this.error = error instanceof Error ? error.message : String(error)
    } finally {
      if (seq === this.#seq) this.busy = false
    }
  }

  /**
   * Run on the worker, falling back to the calling thread for good once the worker proves unusable —
   * a module worker is blocked under `file://` in a packaged renderer (the F-030 lesson), and a
   * feature that quietly does nothing is worse than one that briefly stutters.
   */
  async #exec(request: TraceRequest): Promise<TraceResult> {
    if (this.#preferSync) return traceBitmap(request.image, request.grid, request.options)
    try {
      return await this.#runner.run(request)
    } catch {
      this.#preferSync = true
      return traceBitmap(request.image, request.grid, request.options)
    }
  }
}

/**
 * How a layer becomes pixels. Injectable for the same reason F-051's `prepare`/`decode` hooks are:
 * the real one needs `createImageBitmap`, which jsdom has not got, so component tests hand over a
 * synthetic grid instead of mocking the DOM.
 */
export type Rasteriser = (layer: ReferenceLayer, asset: ReferenceAsset) => Promise<TraceSource>

/** Long enough that a slider drag settles first, short enough to feel like a live preview. */
const DEBOUNCE_MS = 180
