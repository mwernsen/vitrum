import { CUTTABILITY_RULES } from './rules/cuttability'
import { STRUCTURAL_RULES } from './rules/structural'
import { TOPOLOGY_RULES } from './rules/topology'
import type { Rule, RuleId } from './types'

/**
 * The rule registry (F-030). The topology (F-030), cuttability (F-031) and structural (F-032) packs
 * ship today; a further pack appends to this list with no engine change — the runner iterates
 * whatever is registered. Order here is the rules' shipped display order (topology, cuttability,
 * structural).
 */
export const RULES: readonly Rule[] = [...TOPOLOGY_RULES, ...CUTTABILITY_RULES, ...STRUCTURAL_RULES]

export const RULES_BY_ID: ReadonlyMap<RuleId, Rule> = new Map(RULES.map((rule) => [rule.id, rule]))
