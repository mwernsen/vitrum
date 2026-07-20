import { CUTTABILITY_RULES } from './rules/cuttability'
import { TOPOLOGY_RULES } from './rules/topology'
import type { Rule, RuleId } from './types'

/**
 * The rule registry (F-030). The topology pack (F-030) and cuttability pack (F-031) ship today; the
 * structural (F-032) pack appends to this list with no engine change — the runner iterates whatever
 * is registered. Order here is the rules' shipped display order (topology, then cuttability).
 */
export const RULES: readonly Rule[] = [...TOPOLOGY_RULES, ...CUTTABILITY_RULES]

export const RULES_BY_ID: ReadonlyMap<RuleId, Rule> = new Map(RULES.map((rule) => [rule.id, rule]))
