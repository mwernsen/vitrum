/**
 * `@vitrum/drc` — the design-rule-check engine (F-030), Vitrum's KiCad-style ERC/DRC. An
 * extensible registry of rules inspects the document plus its derived data (pieces, diagnostics,
 * glass assignments) and emits located, severity-graded, explained violations. Pure domain logic:
 * no DOM, no Svelte, no worker plumbing, so a full run is unit- and golden-file-testable and lifts
 * onto a worker unchanged. `packages/ui` runs it off the main thread and renders the results.
 *
 * Ships the topology (ERC) rule pack; the cuttability (F-031) and structural (F-032) packs plug
 * into the same registry.
 */

export { runChecks } from './run'
export { RULES, RULES_BY_ID } from './registry'
export { TOPOLOGY_RULES } from './rules/topology'
export { quickFixCommand } from './quickfix'
export { exclusionKey, SEVERITY_RANK } from './identity'
export type {
  DrcInput,
  QuickFix,
  RawViolation,
  Rule,
  RuleId,
  RunResult,
  Severity,
  SeverityCounts,
  Violation,
  WeldQuickFix,
} from './types'
