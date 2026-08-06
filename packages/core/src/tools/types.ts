import type { Arc, CubicBezier, Line, Vec2 } from '@vitrum/geometry'

/**
 * The drawing-tool framework (F-011). The pieces here are pure and Svelte/DOM-free so
 * every tool is unit-testable by folding a sequence of world-space inputs into it and
 * asserting on the segments it commits. The interactive glue — turning raw pointer/key
 * DOM events into these inputs and turning committed drafts into document commands —
 * lives in `packages/ui` (`ToolController`), keeping this layer a pure state machine.
 *
 * Coordinates are **world millimetres** throughout: the UI resolves a screen pointer to
 * world via the viewport before it reaches a tool, so no tool ever sees a raw pixel.
 */

/** The tools a user can activate. `select` is the inert default (no drawing). */
export type ToolId =
  'line' | 'arc' | 'bezier' | 'rectangle' | 'circle' | 'polygon' | 'border' | 'guide'

/** The role a drawn segment carries (mirrors `@vitrum/model`'s `SegmentRole`). */
export type DrawRole = 'lead' | 'construction' | 'border'

/** The geometry a tool can emit. Circular arcs only in v1 (see F-010). */
export type DrawGeometry = Line | Arc | CubicBezier

/** One segment a completed gesture wants added to the document, in world mm. */
export interface SegmentDraft {
  readonly geometry: DrawGeometry
  readonly role: DrawRole
}

/**
 * A parsed numeric entry (KiCad-style "type 120 Enter"). `length` is always in world
 * millimetres — the UI converts from the display unit before it reaches a tool, so FR-2
 * ("a line drawn with numeric entry 100 measures exactly 100 mm") holds. `angle` is an
 * absolute bearing in degrees from +x (Y-down world), optional.
 */
export interface NumericValue {
  readonly length?: number
  readonly angle?: number
}

/** A pointer input already resolved to a world position (snapping applied upstream). */
export interface PointerInput {
  /** Resolved world position, mm. */
  readonly at: Vec2
  /** Shift held ⇒ tools constrain the active span to 0/45/90° (FR-3). */
  readonly shift?: boolean
  /** Alt held ⇒ tool-specific modifier (e.g. break bézier tangent). */
  readonly alt?: boolean
  /**
   * Directions of existing lines through the point the active span is measured from. The UI
   * fills these in from the document so the Shift ladder also offers parallel/perpendicular
   * to the line a span starts from; empty leaves the plain 0/45/90° ladder.
   */
  readonly refDirs?: readonly Vec2[]
  /**
   * The resolver already reconciled the angular constraint with snapping for this position, so a
   * tool must **not** constrain it again. Re-constraining rotates the point about the anchor
   * preserving its distance, which walks it off whatever it had just snapped to — the snap and
   * the constraint would then silently undo each other. See {@link ResolvedPoint.settled}.
   */
  readonly settled?: boolean
}

/**
 * Everything a tool reacts to. Pointer inputs carry a world position; `enter` finishes
 * the gesture, `escape` discards it (FR-5), `numeric` applies a typed length/angle to
 * the active span. Every input is plain data so a test can replay a whole interaction.
 */
export type ToolInput =
  | ({ readonly type: 'down' } & PointerInput)
  | ({ readonly type: 'move' } & PointerInput)
  | ({ readonly type: 'up' } & PointerInput)
  | { readonly type: 'enter' }
  | { readonly type: 'escape' }
  | ({ readonly type: 'numeric'; readonly value: NumericValue } & Partial<PointerInput>)

/**
 * The result of folding one input into a tool. `state` is the next in-progress state;
 * `commit`, when present and non-empty, is the gesture's whole output and MUST be
 * applied as exactly one document command (FR-1) after which the tool resets to
 * `initial`. A tool never mutates the document itself.
 */
export interface ToolStep<S> {
  readonly state: S
  readonly commit?: readonly SegmentDraft[]
}

/** A shape a tool wants painted on the overlay layer as live preview. */
export type PreviewShape =
  | {
      readonly kind: 'segment'
      readonly geometry: DrawGeometry
      readonly role: DrawRole
      /** A rubber-band span not yet placed — drawn fainter/dashed. */
      readonly ghost?: boolean
    }
  | { readonly kind: 'point'; readonly at: Vec2 }

/**
 * A tool: a pure state machine plus its preview. `initial` seeds `ToolController`;
 * `reduce` folds inputs; `preview` renders the current state against the last hover
 * point; `isActive` reports whether a gesture is mid-flight so switching tools can
 * cancel cleanly (FR-5). `S` is private to each tool — callers treat it as opaque.
 */
export interface ToolDef<S> {
  readonly id: ToolId
  readonly role: DrawRole
  readonly initial: S
  reduce(state: S, input: ToolInput): ToolStep<S>
  preview(state: S, hover: Vec2 | null): readonly PreviewShape[]
  isActive(state: S): boolean
  /**
   * Anchors already placed in the current gesture, for the snapping resolver's context
   * (snap-to-self). Optional — a tool with no persistent anchors omits it.
   */
  anchors?(state: S): readonly Vec2[]
  /**
   * Cycle a discrete tool option and return the new state — e.g. the arc's construction
   * mode or the polygon's side count. `ToolController` calls this when the tool's own
   * shortcut is pressed again with no gesture in progress. Optional.
   */
  cycleMode?(state: S): S
  /** A short label for the current mode/option, shown in the canvas HUD. Optional. */
  hint?(state: S): string | null
}

/* -------------------------------------------------------------------------- */
/* Snapping hook — the seam F-012 decorates                                    */
/* -------------------------------------------------------------------------- */

/** Context a resolver may use to snap (e.g. to the gesture's own anchors). */
export interface ResolveContext {
  readonly toolId: ToolId
  /** Anchors already placed in the current gesture, world mm. */
  readonly anchors: readonly Vec2[]
  /**
   * The angular constraint in force (Shift on a tool that locks the span's direction), so the
   * resolver can snap **along** the constrained ray rather than perpendicular to it. Without
   * this the tool constrains whatever the resolver returned, rotating a snapped point off the
   * curve it had just landed on. Absent when no constraint applies.
   */
  readonly constrain?:
    | {
        /** The point the span is measured from — the constraint's pivot. */
        readonly origin: Vec2
        /** Extra reference directions the ladder offers, as in {@link PointerInput.refDirs}. */
        readonly refDirs: readonly Vec2[]
      }
    | undefined
}

/** Details of a snap the resolver applied, for overlay markers (shape reserved for F-012). */
export interface SnapResult {
  readonly kind: string
  readonly world: Vec2
}

/** A resolved pointer position, optionally annotated with the snap that produced it. */
export interface ResolvedPoint {
  readonly world: Vec2
  readonly snap?: SnapResult
  /**
   * Set when the resolver has already applied the active angular constraint (Shift) and settled it
   * against snapping — because only the resolver can see both. The tool must then take this
   * position as final: constraining it again would rotate it off the snap it just landed on.
   */
  readonly settled?: boolean
}

/**
 * The snapping hook. `ToolController` runs every incoming pointer position through the
 * active resolver before building a `ToolInput`, so tools always consume snapped world
 * points. v1 ships {@link identityResolver}; F-012 swaps in one that snaps to grid,
 * nodes and construction guides without any tool changing.
 */
export type PointerResolver = (world: Vec2, ctx: ResolveContext) => ResolvedPoint

/** The no-op resolver: passes the pointer through unchanged. Replaced by F-012. */
export const identityResolver: PointerResolver = (world) => ({ world })
