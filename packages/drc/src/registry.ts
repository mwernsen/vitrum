import { TOPOLOGY_RULES } from './rules/topology'
import type { Rule, RuleId } from './types'

/**
 * The rule registry (F-030). The topology pack ships today; the cuttability (F-031) and
 * structural (F-032) packs append to this list with no engine change — the runner iterates
 * whatever is registered. Order here is the rules' shipped display order.
 */
export const RULES: readonly Rule[] = [...TOPOLOGY_RULES]

export const RULES_BY_ID: ReadonlyMap<RuleId, Rule> = new Map(RULES.map((rule) => [rule.id, rule]))
