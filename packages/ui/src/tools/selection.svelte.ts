import { SvelteSet } from 'svelte/reactivity'

/**
 * The selection model (F-013). Selection lives **outside** the document — it is not a command
 * and never enters undo/redo (the spec's explicit rule) — so it is plain reactive UI state
 * here: a reactive set of selected segment ids the canvas overlay and inspector read. Click
 * cycling through overlapping candidates is handled here too, so a repeated click at one spot
 * walks the stack of curves under the cursor.
 */
export class SelectionController {
  /** The selected segment ids (reactive via `SvelteSet`). */
  readonly selected = new SvelteSet<string>()

  /** Candidate stack + cursor for click-cycling; reset whenever the click target changes. */
  #cycleCandidates: string[] = []
  #cycleIndex = 0

  get size(): number {
    return this.selected.size
  }

  get isEmpty(): boolean {
    return this.selected.size === 0
  }

  has(id: string): boolean {
    return this.selected.has(id)
  }

  /** The one selected id, or null when the selection is empty or multiple. */
  get single(): string | null {
    return this.selected.size === 1 ? [...this.selected][0]! : null
  }

  clear(): void {
    this.#resetCycle()
    this.selected.clear()
  }

  replace(ids: Iterable<string>): void {
    this.selected.clear()
    for (const id of ids) this.selected.add(id)
  }

  add(ids: Iterable<string>): void {
    for (const id of ids) this.selected.add(id)
  }

  toggle(id: string): void {
    if (this.selected.has(id)) this.selected.delete(id)
    else this.selected.add(id)
  }

  remove(ids: Iterable<string>): void {
    for (const id of ids) this.selected.delete(id)
  }

  selectAll(allIds: Iterable<string>): void {
    this.#resetCycle()
    this.replace(allIds)
  }

  invert(allIds: Iterable<string>): void {
    this.#resetCycle()
    const next = [...allIds].filter((id) => !this.selected.has(id))
    this.replace(next)
  }

  /**
   * Resolve a click over the ordered candidate stack under the cursor (nearest first).
   * `additive` (Shift) toggles the nearest candidate into the current selection. A plain click
   * selects the nearest; clicking again at the same stack advances through the overlapping
   * candidates, so hidden curves are reachable. An empty stack clears (plain) or is a no-op
   * (additive).
   */
  click(candidateIds: readonly string[], additive: boolean): void {
    if (candidateIds.length === 0) {
      if (!additive) this.clear()
      this.#resetCycle()
      return
    }
    if (additive) {
      this.toggle(candidateIds[0]!)
      this.#resetCycle()
      return
    }
    const sameStack = sameOrder(candidateIds, this.#cycleCandidates)
    const cyclable =
      sameStack && this.selected.size === 1 && this.selected.has(candidateIds[this.#cycleIndex]!)
    this.#cycleIndex = cyclable ? (this.#cycleIndex + 1) % candidateIds.length : 0
    this.#cycleCandidates = [...candidateIds]
    this.replace([candidateIds[this.#cycleIndex]!])
  }

  #resetCycle(): void {
    this.#cycleCandidates = []
    this.#cycleIndex = 0
  }
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
