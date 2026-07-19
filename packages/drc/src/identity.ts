import type { RawViolation, RuleId, Severity } from './types'

/**
 * The stable waiver key for a violation: its rule id plus the sorted `identity` tokens the rule
 * chose (entity ids, content ids). Sorting makes the key independent of the order a rule lists
 * involved entities, so a near-miss keyed on its two segments waives the same whichever segment
 * the rule happened to name first. This is the key persisted in `Project.drc.exclusions` (FR-3).
 */
export function exclusionKey(ruleId: RuleId, raw: RawViolation): string {
  return `${ruleId}#${[...raw.identity].sort().join('|')}`
}

/** Severity rank for ordering: errors first, then warnings, then info (FR-5 stable output). */
export const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
}
