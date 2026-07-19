import {
  quickFixCommand,
  runChecks,
  type DrcInput,
  type RunResult,
  type Violation,
} from '@vitrum/drc'
import type { Vec2 } from '@vitrum/geometry'
import {
  setDrcExclusion,
  setDrcRuleOverride,
  type Command,
  type DrcRuleOverride,
  type Scheduler,
  type TimerHandle,
} from '@vitrum/model'

import { createDrcRunner, type DrcRunner } from './runner'

const EMPTY: RunResult = {
  violations: [],
  excluded: [],
  counts: { error: 0, warning: 0, info: 0 },
}

const REAL_SCHEDULER: Scheduler = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface DrcControllerOptions {
  /** Command sink for waivers, rule overrides and quick-fixes. Absent ⇒ actions are no-ops. */
  execute?: (command: Command) => void
  /** Zoom-to callback when a violation is selected (FR-2). */
  zoomTo?: (at: Vec2) => void
  /** The runner; defaults to a worker-backed one, falling back to synchronous. */
  runner?: DrcRunner
  /** Live-mode debounce in ms (FR-1: never block drawing). */
  debounceMs?: number
  /** Injectable timer, for deterministic tests. */
  scheduler?: Scheduler
}

/**
 * The reactive bridge to the DRC engine (F-030). It runs checks off the main thread (debounced in
 * live mode, immediate for an explicit "Run checks"), mirrors the latest {@link RunResult} into
 * runes, owns the selected-violation state that drives zoom-to and the canvas ring, and turns the
 * panel's actions (waive, rule override, quick-fix) into document commands. The engine stays the
 * single source of truth for *what* is wrong; this class only schedules it and routes its output.
 */
export class DrcController {
  result = $state<RunResult>(EMPTY)
  /** True while a run is in flight — the panel shows a subtle "checking" state, never blocks. */
  running = $state(false)
  /** False until the first run completes, so the readiness pill can read "not run yet". */
  hasRun = $state(false)
  /** The selected violation's key (drives zoom-to and the canvas ring). */
  selectedKey = $state<string | null>(null)
  /** Whether the panel is showing the excluded (waived) tab. */
  showExcluded = $state(false)

  readonly #runner: DrcRunner
  readonly #execute: ((command: Command) => void) | undefined
  readonly #zoomTo: ((at: Vec2) => void) | undefined
  readonly #debounceMs: number
  readonly #scheduler: Scheduler
  #timer: TimerHandle | undefined
  #pending: DrcInput | undefined
  #runToken = 0
  // Once the worker proves unusable (e.g. a module worker blocked under file://), stick to the
  // synchronous fallback so later runs don't each pay a failed round-trip.
  #preferSync = false

  constructor(options: DrcControllerOptions = {}) {
    this.#runner = options.runner ?? createDrcRunner()
    this.#execute = options.execute
    this.#zoomTo = options.zoomTo
    this.#debounceMs = options.debounceMs ?? 250
    this.#scheduler = options.scheduler ?? REAL_SCHEDULER
  }

  /** Canvas markers for the active violations (F-030 overlay). */
  markers = $derived(
    this.result.violations.map((v) => ({ at: v.at, severity: v.severity, key: v.key })),
  )

  /** Live mode: (re)schedule a debounced run against the latest input. */
  schedule(input: DrcInput): void {
    this.#pending = input
    if (this.#timer !== undefined) this.#scheduler.clearTimer(this.#timer)
    this.#timer = this.#scheduler.setTimer(() => {
      this.#timer = undefined
      const next = this.#pending
      if (next) void this.#run(next)
    }, this.#debounceMs)
  }

  /** Explicit "Run checks": cancel any pending debounce and run immediately. */
  runNow(input: DrcInput): Promise<void> {
    if (this.#timer !== undefined) {
      this.#scheduler.clearTimer(this.#timer)
      this.#timer = undefined
    }
    return this.#run(input)
  }

  async #run(input: DrcInput): Promise<void> {
    const token = ++this.#runToken
    this.running = true
    try {
      const result = await this.#exec(input)
      // Ignore a stale run superseded by a newer one.
      if (token !== this.#runToken) return
      this.result = result
      this.hasRun = true
    } finally {
      if (token === this.#runToken) this.running = false
    }
  }

  /** Run via the worker, falling back to a synchronous run if it is (or becomes) unavailable. */
  async #exec(input: DrcInput): Promise<RunResult> {
    if (this.#preferSync) return runChecks(input)
    try {
      return await this.#runner.run(input)
    } catch {
      this.#preferSync = true
      return runChecks(input)
    }
  }

  /** Select a violation (or clear with null): rings it on the canvas and zooms to it (FR-2). */
  select(violation: Violation | null): void {
    this.selectedKey = violation?.key ?? null
    if (violation && this.#zoomTo) this.#zoomTo(violation.at)
  }

  /** Waive a violation with an optional note (FR-3). Persisted in the document, undoable. */
  waive(violation: Violation, note?: string): void {
    const trimmed = note?.trim()
    this.#execute?.(setDrcExclusion(violation.key, trimmed ? { note: trimmed } : {}))
    if (this.selectedKey === violation.key) this.selectedKey = null
  }

  /** Un-waive a previously excluded violation by key (FR-3). */
  unwaive(key: string): void {
    this.#execute?.(setDrcExclusion(key, null))
  }

  /** Set (or clear, with null) a rule's per-project severity/enable override (FR-4). */
  setRuleOverride(ruleId: string, override: DrcRuleOverride | null): void {
    this.#execute?.(setDrcRuleOverride(ruleId, override))
  }

  /** Apply a violation's one-click quick-fix (F-030 open question 1: weld). */
  applyQuickFix(violation: Violation): void {
    if (!violation.quickFix) return
    this.#execute?.(quickFixCommand(violation.quickFix))
    if (this.selectedKey === violation.key) this.selectedKey = null
  }

  dispose(): void {
    if (this.#timer !== undefined) this.#scheduler.clearTimer(this.#timer)
    this.#runner.dispose()
  }
}
