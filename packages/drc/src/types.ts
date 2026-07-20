import type { CutContour, Diagnostic, Piece, TechniqueKind } from '@vitrum/core'
import type { GlassId, Project, Severity } from '@vitrum/model'
import type { Vec2 } from '@vitrum/geometry'

/**
 * The DRC engine (F-030), modelled on KiCad's ERC/DRC: an extensible registry of {@link Rule}s
 * that inspect the document plus its derived data and emit located, severity-graded, explained
 * {@link Violation}s. This module is pure data + free functions — no DOM, no Svelte, no worker
 * plumbing — so a full run is unit- and golden-file-testable and can be lifted onto a worker
 * unchanged (FR-1). The topology (ERC) rule pack ships here; cuttability (F-031) and structural
 * (F-032) packs plug into the same registry with no engine change.
 */

export type { Severity }

/** The id of a shipped rule. Extending the pack adds to this union. */
export type RuleId =
  // Topology (ERC) pack — F-030
  | 'open-border'
  | 'dangling-line'
  | 'near-miss-joint'
  | 'duplicate-segment'
  | 'unassigned-glass'
  | 'orphan-region'
  // Cuttability pack — F-031
  | 'min-piece-size'
  | 'sliver'
  | 'concave-curvature'
  | 'concave-notch'
  | 'sharp-point'
  | 'degenerate-cut-contour'
  // Structural pack — F-032
  | 'hinge-line'
  | 'crowded-joint'
  | 'panel-needs-reinforcement'
  | 'panel-weight'
  | 'tiny-edge-contact'

/**
 * The document + derived data a rule inspects. Everything here is plain, structured-cloneable
 * data (no closures) so the whole input can be posted to a worker. `pieces` and `diagnostics`
 * come from F-020's detection; `cutContours` are F-021's technique-inset contours (one per piece,
 * joined by `pieceId`), the geometry the cuttability pack (F-031) checks; `assignedKeys` are the
 * content ids of pieces with an *effective* glass (F-023, direct or inherited) — resolving
 * inheritance is the caller's job so the engine stays a pure function of its input.
 */
export interface DrcInput {
  readonly project: Project
  readonly pieces: readonly Piece[]
  readonly diagnostics: readonly Diagnostic[]
  readonly cutContours: readonly CutContour[]
  readonly assignedKeys: readonly string[]
  /**
   * Each piece's *effective* glass (F-023), keyed by content id → project {@link GlassId}: the
   * direct assignment, or the one inherited across a split/merge. Resolving inheritance is the
   * caller's job (as with {@link assignedKeys}), so the engine stays a pure function of its input.
   * The structural `panel-weight` rule (F-032) reads each glass's thickness through this map; a
   * piece with no effective glass is weighed at the default 3 mm. Optional so pre-F-032 callers
   * (and golden fixtures with no assignments) still typecheck — absent means "weigh everything at
   * the default thickness".
   */
  readonly effectiveGlass?: Readonly<Record<string, GlassId>>
}

/**
 * A one-click fix a rule can attach to a violation (F-030 open question 1: yes, with weld as the
 * pilot). Kept as pure data — the id-only payload is turned into a document `Command` by
 * {@link quickFixCommand}, so the engine never imports command machinery into a rule.
 */
export interface WeldQuickFix {
  readonly kind: 'weld'
  /** The node the two endpoints collapse onto. */
  readonly keepNodeId: string
  /** The node folded into `keepNodeId` and removed. */
  readonly dropNodeId: string
  readonly label: string
}

export type QuickFix = WeldQuickFix

/**
 * What a rule emits per problem, before the runner resolves effective severity and identity.
 * `identity` are the stable tokens (entity ids, content ids) that make this violation unique
 * within its rule; combined with the rule id they form the waiver key, so a waiver survives
 * edits that leave those entities intact (FR-3).
 */
export interface RawViolation {
  readonly at: Vec2
  readonly message: string
  readonly identity: readonly string[]
  readonly segmentIds?: readonly string[]
  readonly pieceIds?: readonly string[]
  readonly distance?: number
  readonly quickFix?: QuickFix
  /**
   * A per-violation severity, escalating this one instance above the rule's `defaultSeverity`.
   * Some cuttability rules grade themselves (F-031): `min-piece-size` is a warning but an error
   * below half the minimum; `concave-curvature` is a warning but an error under a hard radius. A
   * project's severity override, when present, still replaces this (an explicit override wins).
   */
  readonly severity?: Severity
}

/** A located, severity-graded, explained problem — the engine's output unit. */
export interface Violation {
  readonly ruleId: RuleId
  readonly title: string
  /** Effective severity, after any per-project override (FR-4). */
  readonly severity: Severity
  readonly message: string
  /** Why this matters when the panel is actually cut and built — craft education (Scope). */
  readonly explain: string
  readonly at: Vec2
  readonly segmentIds: readonly string[]
  readonly pieceIds: readonly string[]
  readonly distance?: number
  readonly quickFix?: QuickFix
  /** Stable waiver identity (rule id + sorted `identity` tokens). */
  readonly key: string
  /** The waiver note, present only on an excluded violation. */
  readonly note?: string
}

/**
 * A tunable threshold a rule reads (F-031). Cuttability limits are craft numbers that differ by
 * technique (copper foil permits finer work than lead) and that a workshop may want to retune, so
 * each is declared here as data: a stable `key` (the persistence + override key), a `label`/`unit`
 * for the settings UI, the `rationale` that documents *why* the default is what it is, and the
 * per-technique default. A project override pins a single value across techniques; with no override
 * the effective value is `defaultFor(project.technique.kind)`, so it switches automatically (FR-4).
 */
export interface ThresholdSpec {
  readonly key: string
  readonly label: string
  readonly unit: string
  readonly rationale: string
  defaultFor(kind: TechniqueKind): number
}

/**
 * One design rule. `check` is pure: same input, same violations, in a deterministic order.
 * `defaultSeverity` and `explain` are the rule's shipped defaults; a project can override the
 * severity or disable the rule (FR-4). `thresholds` (F-031) declares the rule's tunable limits so
 * the settings UI can render and persist them; topology rules carry none.
 */
export interface Rule {
  readonly id: RuleId
  readonly title: string
  readonly defaultSeverity: Severity
  readonly explain: string
  readonly thresholds?: readonly ThresholdSpec[]
  check(input: DrcInput): RawViolation[]
}

export interface SeverityCounts {
  readonly error: number
  readonly warning: number
  readonly info: number
}

/**
 * The result of a full run: `violations` are active (shown on the canvas and in the panel),
 * `excluded` are currently-matching waivers (listed in the "excluded" tab, FR-3). Both are
 * ranked most-severe first with a deterministic tiebreak, so the UI and golden files are stable.
 */
export interface RunResult {
  readonly violations: readonly Violation[]
  readonly excluded: readonly Violation[]
  readonly counts: SeverityCounts
}
