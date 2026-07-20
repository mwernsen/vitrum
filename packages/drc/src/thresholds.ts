import type { DrcInput, RuleId, ThresholdSpec } from './types'

/**
 * The effective value of a rule threshold for a project (F-031). A per-project override pins a
 * single value that wins regardless of technique; with no override the value is the shipped
 * per-technique default, so switching lead ↔ foil re-derives it automatically (FR-4).
 */
export function resolveThreshold(input: DrcInput, ruleId: RuleId, spec: ThresholdSpec): number {
  const override = input.project.drc.rules[ruleId]?.thresholds?.[spec.key]
  return override ?? spec.defaultFor(input.project.technique.kind)
}
