import { pieceKey, type Piece } from '@vitrum/core'
import {
  updateNestingSettings,
  type Command,
  type Glass,
  type GlassId,
  type GlassNestConfig,
  type NestingSettings,
  type NestRotationPolicy,
  type Project,
  type SheetSize,
} from '@vitrum/model'
import {
  nestSheets,
  type NestGlassInput,
  type NestInput,
  type NestPart,
  type NestProgress,
  type NestResult,
  type NestSheetSize,
} from '@vitrum/nest'

import { createNestRunner, type NestRunner } from './runner'

/** The fallback sheet used when a glass carries no catalog sheet sizes. Full-sheet stock (mm). */
export const FALLBACK_SHEET: NestSheetSize = { widthMm: 610, heightMm: 914, label: 'full sheet' }

export interface NestControllerDeps {
  getDoc: () => Project
  execute: (command: Command) => void
  /** Live detected pieces (F-020). */
  getPieces: () => readonly Piece[]
  /** A piece's effective glass (F-023), or undefined when unassigned. */
  glassFor: (piece: Piece) => GlassId | undefined
  /** A piece's effective number/label (F-040), or undefined when unnumbered. */
  labelFor: (piece: Piece) => string | undefined
  /** The runner; defaults to a worker-backed one, falling back to synchronous. */
  runner?: NestRunner
}

/** The default rotation policy for a glass: streaky glass is grain-constrained, else free-quadrant. */
export function defaultRotationFor(glass: Glass | undefined): NestRotationPolicy {
  return glass?.texture === 'streaky' ? 'flip' : 'quadrant'
}

/** The catalog sheet sizes offered for a glass, always including the fallback as a last resort. */
export function sheetOptionsFor(glass: Glass | undefined): NestSheetSize[] {
  const sizes = glass?.sheetSizes ?? []
  return sizes.length > 0 ? sizes.map((s) => ({ ...s })) : [FALLBACK_SHEET]
}

/** The largest catalog sheet for a glass (by area), or the fallback. */
function defaultSheetFor(glass: Glass | undefined): NestSheetSize {
  const options = sheetOptionsFor(glass)
  return options.reduce((best, s) =>
    s.widthMm * s.heightMm > best.widthMm * best.heightMm ? s : best,
  )
}

function sameSheet(a: NestSheetSize, b: SheetSize): boolean {
  return a.widthMm === b.widthMm && a.heightMm === b.heightMm && (a.label ?? '') === (b.label ?? '')
}

/**
 * The reactive bridge to the nesting engine (F-057). It owns the nested-layout result and progress
 * runes, runs the engine off the main thread with progress and cancel, resolves each glass's effective
 * sheet + rotation policy (deriving grain-safe defaults from the glass texture), and turns the control
 * panel's edits (cut allowance, per-glass sheet/rotation, reshuffle) into `updateNestingSettings`
 * commands. The nested layout is a **derived output** — it is never stored; only the tunable intent on
 * `Project.nesting` is, so the same document + seed always re-nests identically (FR-3).
 */
export class NestController {
  result = $state<NestResult | null>(null)
  running = $state(false)
  progress = $state<NestProgress | null>(null)
  error = $state<string | null>(null)
  /** False until the first run completes, so the view can show a "not nested yet" empty state. */
  hasRun = $state(false)

  readonly #deps: NestControllerDeps
  readonly #runner: NestRunner
  #runToken = 0
  #preferSync = false

  constructor(deps: NestControllerDeps) {
    this.#deps = deps
    this.#runner = deps.runner ?? createNestRunner()
  }

  get settings(): NestingSettings {
    return this.#deps.getDoc().nesting
  }

  /** Glass ids that have at least one assigned, numbered-or-not piece — the ones we can nest. */
  get glassesInUse(): GlassId[] {
    const seen: GlassId[] = []
    for (const piece of this.#deps.getPieces()) {
      const g = this.#deps.glassFor(piece)
      if (g && !seen.includes(g)) seen.push(g)
    }
    return seen
  }

  /** The resolved sheet + rotation policy for a glass (explicit override, else derived default). */
  configFor(glassId: GlassId): { sheet: NestSheetSize; rotation: NestRotationPolicy } {
    const glass = this.#deps.getDoc().glasses[glassId]
    const override: GlassNestConfig | undefined = this.settings.perGlass[glassId]
    return {
      sheet: override?.sheet ? { ...override.sheet } : defaultSheetFor(glass),
      rotation: override?.rotation ?? defaultRotationFor(glass),
    }
  }

  sheetOptions(glassId: GlassId): NestSheetSize[] {
    return sheetOptionsFor(this.#deps.getDoc().glasses[glassId])
  }

  /** Build the pure engine input from the live pieces + assignments + numbering + resolved glasses. */
  buildInput(): NestInput {
    const parts: NestPart[] = []
    for (const piece of this.#deps.getPieces()) {
      const glassId = this.#deps.glassFor(piece)
      if (!glassId) continue // unassigned pieces have no sheet to nest onto
      parts.push({
        id: pieceKey(piece),
        label: this.#deps.labelFor(piece) ?? '',
        glassId,
        ring: piece.ring,
        holes: piece.holeRings,
      })
    }
    const glasses: NestGlassInput[] = this.glassesInUse.map((glassId) => {
      const cfg = this.configFor(glassId)
      return { glassId, sheet: cfg.sheet, rotation: cfg.rotation }
    })
    return { parts, glasses, spacingMm: this.settings.spacingMm, seed: this.settings.seed }
  }

  /** Whether there is anything to nest (at least one assigned piece). */
  get canNest(): boolean {
    return this.#deps.getPieces().some((p) => this.#deps.glassFor(p) !== undefined)
  }

  /** Run the nester against the current document state. Supersedes any in-flight run. */
  async run(): Promise<void> {
    const input = this.buildInput()
    const token = ++this.#runToken
    this.running = true
    this.error = null
    this.progress = { fraction: 0, glassId: null, sheets: 0 }
    try {
      const result = await this.#exec(input, (p) => {
        if (token === this.#runToken) this.progress = p
      })
      if (token !== this.#runToken) return // superseded
      this.result = result
      this.hasRun = true
    } catch (err) {
      if (token !== this.#runToken) return // cancelled/superseded
      this.error = err instanceof Error ? err.message : String(err)
    } finally {
      if (token === this.#runToken) {
        this.running = false
        this.progress = null
      }
    }
  }

  async #exec(input: NestInput, onProgress: (p: NestProgress) => void): Promise<NestResult> {
    if (this.#preferSync) return nestSheets(input, onProgress)
    try {
      return await this.#runner.run(input, onProgress)
    } catch (err) {
      if (err instanceof Error && err.message === 'nest cancelled') throw err
      // Worker unusable (e.g. blocked under file://) — fall back to a synchronous run from here on.
      this.#preferSync = true
      return nestSheets(input, onProgress)
    }
  }

  /** Cancel the in-flight run. The last completed result (if any) stays on screen. */
  cancel(): void {
    this.#runToken++ // orphan the in-flight promise
    this.#runner.cancel()
    this.running = false
    this.progress = null
  }

  // --- Settings edits (each one undo entry) --------------------------------

  #patch(patch: Partial<NestingSettings>): void {
    this.#deps.execute(updateNestingSettings(patch))
  }

  /** Set the cut allowance (mm), clamped ≥ 0. */
  setSpacing(mm: number): void {
    const spacingMm = Math.max(0, mm)
    if (spacingMm !== this.settings.spacingMm) this.#patch({ spacingMm })
  }

  /**
   * Bump the seed and re-nest to explore a different layout. The seed persists, so the new layout is
   * itself reproducible (F-057 FR-3) — reshuffle just steps to the next one.
   */
  reshuffle(): void {
    this.#patch({ seed: (this.settings.seed >>> 0) + 1 })
    void this.run()
  }

  setGlassSheet(glassId: GlassId, sheet: NestSheetSize): void {
    const prior = this.settings.perGlass[glassId]
    const perGlass = { ...this.settings.perGlass, [glassId]: { ...prior, sheet } }
    this.#patch({ perGlass })
  }

  setGlassRotation(glassId: GlassId, rotation: NestRotationPolicy): void {
    const prior = this.settings.perGlass[glassId]
    const perGlass = { ...this.settings.perGlass, [glassId]: { ...prior, rotation } }
    this.#patch({ perGlass })
  }

  /** True when a sheet option matches this glass's current resolved choice (for `<select>` state). */
  isSelectedSheet(glassId: GlassId, option: NestSheetSize): boolean {
    return sameSheet(option, this.configFor(glassId).sheet)
  }

  dispose(): void {
    this.#runner.dispose()
  }
}
