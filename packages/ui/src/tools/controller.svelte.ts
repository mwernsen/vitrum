import {
  arcTool,
  bezierTool,
  borderTool,
  circleTool,
  guideTool,
  identityResolver,
  lineDirectionsAt,
  lineTool,
  parseNumericEntry,
  polygonTool,
  rectangleTool,
  isNumericChar,
  screenToWorld,
  type DrawRole,
  type PointerResolver,
  type PreviewShape,
  type SegmentDraft,
  type ToolDef,
  type ToolId,
  type ToolInput,
} from '@vitrum/core'
import type { Vec2 } from '@vitrum/geometry'
import {
  addSegmentsWelded,
  replaceSegments,
  segmentsFromDrafts,
  type Command,
  type Node,
  type NodeId,
  type Segment,
} from '@vitrum/model'

import type { ViewportController } from '../canvas/viewport.svelte'

/** What the tool layer needs from its surroundings: the viewport and the document. */
export interface ToolHost {
  readonly viewport: ViewportController
  /** Apply one command to the document. One gesture ⇒ exactly one call (FR-1). */
  execute(command: Command): void
  /** The current segments, so the border tool can enforce one contour per document. */
  getSegments(): readonly Segment[]
  /** The current nodes, so a committed gesture welds to existing junctions (F-013). */
  getNodes(): Readonly<Record<NodeId, Node>>
}

/**
 * How close (screen px) the span's origin must be to an existing line for that line to join the
 * Shift ladder as a parallel/perpendicular reference.
 */
const REF_DIR_TOL_PX = 1

/**
 * The tools whose Shift constrains the active span to an angular ladder (as opposed to the span
 * tools, where Shift keeps the shape square/uniform). Only these tell the resolver to snap along
 * the constrained ray.
 */
const ANGULAR_CONSTRAINT_TOOLS = new Set<ToolId>(['line', 'arc'])

/** The tools available for activation, keyed by their single-key shortcut. */
const SHORTCUTS: Record<string, ToolId> = {
  l: 'line',
  a: 'arc',
  b: 'bezier',
  r: 'rectangle',
  c: 'circle',
  p: 'polygon',
  g: 'guide',
}

/**
 * The registered tools. Each is a plain {@link ToolDef} built on the same framework; the
 * controller is entirely tool-agnostic. `border` has no single-key shortcut (the resolved
 * shortcut set is L/A/B/R/C/P), so it activates from the toolbar only.
 */
const TOOLS: Partial<Record<ToolId, ToolDef<unknown>>> = {
  line: lineTool as ToolDef<unknown>,
  arc: arcTool as ToolDef<unknown>,
  bezier: bezierTool as ToolDef<unknown>,
  rectangle: rectangleTool as ToolDef<unknown>,
  circle: circleTool as ToolDef<unknown>,
  polygon: polygonTool as ToolDef<unknown>,
  border: borderTool as ToolDef<unknown>,
  guide: guideTool as ToolDef<unknown>,
}

/**
 * A type-erased handle to one running tool. The generic factory captures the tool's state
 * type `S` in a closure, so the controller can hold tools of different state types without
 * an existential-type dance or `any`. State lives here (plain, not a rune); the controller
 * bumps a reactive tick after each fold so Svelte re-derives the preview.
 */
interface ToolRunner {
  readonly id: ToolId
  readonly role: DrawRole
  reduce(input: ToolInput): readonly SegmentDraft[] | undefined
  preview(hover: Vec2 | null): readonly PreviewShape[]
  isActive(): boolean
  anchors(): readonly Vec2[]
  /** Cycle the tool's mode/option; returns true if the tool had one to cycle. */
  cycleMode(): boolean
  hint(): string | null
}

function makeRunner<S>(def: ToolDef<S>): ToolRunner {
  let state = def.initial
  return {
    id: def.id,
    role: def.role,
    reduce(input) {
      const step = def.reduce(state, input)
      state = step.state
      return step.commit
    },
    preview: (hover) => def.preview(state, hover),
    isActive: () => def.isActive(state),
    anchors: () => (def.anchors ? def.anchors(state) : []),
    cycleMode() {
      if (!def.cycleMode) return false
      state = def.cycleMode(state)
      return true
    },
    hint: () => (def.hint ? def.hint(state) : null),
  }
}

/**
 * The drawing-tool controller (F-011): the one active tool, single-key activation,
 * Esc-to-cancel, KiCad numeric entry, and the snapping hook (`resolver`). It turns raw
 * pointer/key events into world-space {@link ToolInput}s — every pointer position goes
 * through `viewport.screenToWorld` and then the resolver, so tools never see a raw pixel
 * (F-011 technical guidance) — and turns a tool's committed drafts into exactly one
 * document command. All rendering is done by the canvas from `previewShapes`.
 */
export class ToolController {
  readonly #host: ToolHost

  /** The active tool, or `select` (the inert default: pan/zoom only, no drawing). */
  activeId = $state<ToolId | 'select'>('select')
  /** Current numeric-entry buffer (KiCad-style); empty when not typing a value. */
  numericBuffer = $state('')
  /** A short mode label for the active tool (arc construction, N-gon sides), or null. */
  hint = $state<string | null>(null)
  shift = $state(false)
  alt = $state(false)

  #runner: ToolRunner | null = null
  #cursor = $state<Vec2 | null>(null)
  #lastScreen: Vec2 | null = null
  /** Bumped after every fold so `previewShapes`/`active` recompute over opaque tool state. */
  #tick = $state(0)

  /** The snapping hook. Identity in v1; F-012 replaces it to snap to grid/nodes/guides. */
  resolver: PointerResolver = identityResolver

  constructor(host: ToolHost) {
    this.#host = host
  }

  /** World-space shapes the canvas overlay should paint as live preview. */
  previewShapes = $derived.by<readonly PreviewShape[]>(() => {
    void this.#tick
    return this.#runner ? this.#runner.preview(this.#cursor) : []
  })

  /** True while a gesture is mid-flight (an anchor placed, a drag started). */
  active = $derived.by<boolean>(() => {
    void this.#tick
    return this.#runner?.isActive() ?? false
  })

  /** Activate a tool by id. Cancels any in-progress gesture first (FR-5). */
  activate(id: ToolId): void {
    this.#cancelGesture()
    const def = TOOLS[id]
    this.#runner = def ? makeRunner(def) : null
    this.activeId = def ? id : 'select'
    this.numericBuffer = ''
    this.hint = this.#runner?.hint() ?? null
    this.#bump()
  }

  /** Return to the inert select tool, cancelling any gesture. */
  deactivate(): void {
    this.#cancelGesture()
    this.#runner = null
    this.activeId = 'select'
    this.numericBuffer = ''
    this.hint = null
    this.#bump()
  }

  // --- Pointer ---------------------------------------------------------------

  pointerDown(screen: Vec2, mods: { shift: boolean; alt: boolean }): void {
    if (!this.#runner) return
    this.#applyMods(mods)
    this.#lastScreen = screen
    const { world, settled } = this.#resolve(screen)
    this.#cursor = world
    this.#dispatch({ type: 'down', at: world, ...this.#modifiers(), settled })
  }

  pointerMove(screen: Vec2, mods: { shift: boolean; alt: boolean }): void {
    if (!this.#runner) return
    this.#applyMods(mods)
    this.#lastScreen = screen
    const { world, settled } = this.#resolve(screen)
    this.#cursor = world
    this.#dispatch({ type: 'move', at: world, ...this.#modifiers(), settled })
  }

  pointerUp(screen: Vec2, mods: { shift: boolean; alt: boolean }): void {
    if (!this.#runner) return
    this.#applyMods(mods)
    const { world, settled } = this.#resolve(screen)
    this.#dispatch({ type: 'up', at: world, ...this.#modifiers(), settled })
  }

  // --- Keyboard --------------------------------------------------------------

  /**
   * Handle a key press. Returns `true` when the tool layer consumed it, so the canvas
   * knows not to also act (e.g. so a numeric `-` does not zoom out). Single letters
   * activate tools; digits/comma/point feed numeric entry while a gesture is active;
   * Enter finishes (or applies a typed value); Esc cancels the gesture or the tool.
   */
  handleKeyDown(event: KeyboardEvent): boolean {
    if (isTyping(event.target)) return false
    if (event.key === 'Shift') this.shift = true
    if (event.key === 'Alt') this.alt = true
    if (event.metaKey || event.ctrlKey || event.altKey) return false

    switch (event.key) {
      case 'Escape':
        if (this.numericBuffer !== '') {
          this.numericBuffer = ''
          return true
        }
        if (this.active) {
          this.#dispatch({ type: 'escape' })
          return true
        }
        if (this.#runner) {
          this.deactivate()
          return true
        }
        return false
      case 'Enter':
        if (!this.#runner) return false
        this.#commitNumericOrFinish()
        return true
      case 'Backspace':
        if (this.numericBuffer !== '') {
          this.numericBuffer = this.numericBuffer.slice(0, -1)
          return true
        }
        return false
    }

    const shortcut = SHORTCUTS[event.key.toLowerCase()]
    if (shortcut && event.key.length === 1 && !this.#typingNumber()) {
      // Re-pressing the active tool's key cycles its mode (arc construction, N-gon sides)
      // when no gesture is in progress; otherwise it (re)activates the tool.
      if (shortcut === this.activeId && this.#runner && !this.active && this.#runner.cycleMode()) {
        this.hint = this.#runner.hint()
        this.#bump()
        return true
      }
      this.activate(shortcut)
      return true
    }

    // Numeric entry only while a gesture is in progress, so digits/`-`/`.` otherwise
    // stay free for viewport shortcuts.
    if (this.active && isNumericChar(event.key)) {
      this.numericBuffer += event.key
      return true
    }
    return false
  }

  handleKeyUp(event: KeyboardEvent): void {
    if (event.key === 'Shift') this.shift = false
    if (event.key === 'Alt') this.alt = false
    // Re-apply the (un)constrained rubber band without waiting for a pointer move.
    if (this.#runner && this.#lastScreen) {
      const { world, settled } = this.#resolve(this.#lastScreen)
      this.#cursor = world
      this.#dispatch({ type: 'move', at: world, ...this.#modifiers(), settled })
    }
  }

  // --- internals -------------------------------------------------------------

  #commitNumericOrFinish(): void {
    if (this.numericBuffer !== '') {
      const value = parseNumericEntry(this.numericBuffer, this.#host.viewport.unit)
      this.numericBuffer = ''
      if (value) {
        this.#dispatch({ type: 'numeric', value, ...this.#modifiers() })
        return
      }
    }
    this.#dispatch({ type: 'enter' })
  }

  #dispatch(input: ToolInput): void {
    if (!this.#runner) return
    const commit = this.#runner.reduce(input)
    this.#bump()
    if (commit && commit.length > 0) this.#commit(commit)
  }

  #commit(drafts: readonly SegmentDraft[]): void {
    // The border tool replaces the single border contour (v1): removing any existing
    // border segments and adding the new ones in one undo entry. A contour is closed on
    // itself, so it needs no junction welding.
    if (drafts.every((d) => d.role === 'border')) {
      const segments = segmentsFromDrafts(drafts, this.#host.getNodes())
      const existing = this.#host
        .getSegments()
        .filter((s) => s.role === 'border')
        .map((s) => s.id)
      this.#host.execute(replaceSegments(existing, segments))
      return
    }
    // Weld the gesture into the network: coincident endpoints within it share a node, an endpoint
    // snapped onto an existing junction reuses that node id, and an endpoint that landed on
    // another segment's *interior* splits it into a real T-junction (F-013) — so a line drawn
    // onto the frame is genuinely joined to it, not a free end resting on top of it.
    this.#host.execute(
      addSegmentsWelded(
        { segments: this.#host.getSegments(), nodes: this.#host.getNodes() },
        drafts,
      ),
    )
  }

  /**
   * Directions of the document lines through the point the active span is measured from (the
   * gesture's last anchor). Shift then constrains parallel/perpendicular to those as well as to
   * the world axes, so a span drawn off an existing line can follow it. Empty with no gesture
   * in progress, or when the anchor sits on no line.
   */
  #refDirs(): readonly Vec2[] {
    const origin = (this.#runner?.anchors() ?? []).at(-1)
    if (!origin) return []
    const tolMm = REF_DIR_TOL_PX / this.#host.viewport.transform.scale
    return lineDirectionsAt(
      this.#host.getSegments().map((s) => s.geometry),
      origin,
      tolMm,
    )
  }

  /** The modifier/reference fields every pointer input carries. */
  #modifiers(): { shift: boolean; alt: boolean; refDirs: readonly Vec2[] } {
    return { shift: this.shift, alt: this.alt, refDirs: this.#refDirs() }
  }

  #resolve(screen: Vec2): { world: Vec2; settled: boolean } {
    const world = screenToWorld(this.#host.viewport.transform, screen)
    const anchors = this.#runner?.anchors() ?? []
    const activeId = this.#runner?.id ?? 'line'
    const resolved = this.resolver(world, {
      toolId: activeId,
      anchors,
      constrain: this.#constraint(anchors, activeId),
    })
    return { world: resolved.world, settled: resolved.settled ?? false }
  }

  /**
   * The angular constraint the resolver should snap along, or undefined. Only the tools whose
   * Shift locks the span's *direction* qualify — for a span tool Shift means "keep it square",
   * which is not a ray. Telling the resolver lets it put the endpoint where the locked ray crosses
   * a curve, instead of the tool rotating a freshly-snapped point back off that curve.
   */
  #constraint(
    anchors: readonly Vec2[],
    toolId: ToolId,
  ): { origin: Vec2; refDirs: readonly Vec2[] } | undefined {
    if (!this.shift || !ANGULAR_CONSTRAINT_TOOLS.has(toolId)) return undefined
    const origin = anchors.at(-1)
    return origin ? { origin, refDirs: this.#refDirs() } : undefined
  }

  #cancelGesture(): void {
    if (this.#runner && this.#runner.isActive()) this.#runner.reduce({ type: 'escape' })
  }

  #applyMods(mods: { shift: boolean; alt: boolean }): void {
    this.shift = mods.shift
    this.alt = mods.alt
  }

  #typingNumber(): boolean {
    return this.numericBuffer !== ''
  }

  #bump(): void {
    this.#tick++
  }
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}
