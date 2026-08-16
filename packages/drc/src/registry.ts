import { CUTTABILITY_RULES } from './rules/cuttability'
import { FIT_RULES } from './rules/fit'
import { STRUCTURAL_RULES } from './rules/structural'
import { TOPOLOGY_RULES } from './rules/topology'
import type { Rule, RuleId } from './types'

/**
 * The rule registry (F-030). The topology (F-030), cuttability (F-031), structural (F-032) and
 * panel-fit (F-033) packs ship today; a further pack appends to this list with no engine change —
 * the runner iterates whatever is registered. Order here is the rules' shipped display order
 * (topology, cuttability, structural, fit).
 */
export const RULES: readonly Rule[] = [
  ...TOPOLOGY_RULES,
  ...CUTTABILITY_RULES,
  ...STRUCTURAL_RULES,
  ...FIT_RULES,
]

export const RULES_BY_ID: ReadonlyMap<RuleId, Rule> = new Map(RULES.map((rule) => [rule.id, rule]))
